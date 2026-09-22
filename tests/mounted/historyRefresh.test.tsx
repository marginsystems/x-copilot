import { StrictMode, type ReactNode, type Dispatch, type SetStateAction } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { SessionBoundary, useSession } from "../../src/auth/session";
import { useDeskHistory } from "../../src/desk/useDeskHistory";
import { useActivityStrip } from "../../src/desk/useActivityStrip";
import { useSkipDismiss } from "../../src/desk/useSkipDismiss";
import type { ThreadCard } from "../../src/desk/types";
import { DEFAULT_SETTINGS } from "../../src/lib/settings";
import { emptyActivityStats } from "../../src/lib/activityStats";
import { emptyGamificationStats } from "../../src/lib/gamification";
import { authUser } from "./support/authUser";
import { deferred } from "./support/deferred";

function wrapper({ children }: { children: ReactNode }) {
  return <StrictMode><SessionBoundary>{children}</SessionBoundary></StrictMode>;
}

beforeEach(() => {
  sessionStorage.setItem("x-copilot-flight-path-open", "1");
});
const row = (threadId: string) => ({ threadId, author: "author", at: "2026-09-16" });
const response = (data: unknown) => new Response(JSON.stringify(data));
function setup() {
  const requests: ReturnType<typeof deferred<Response>>[] = [];
  const fetch = vi.fn(() => {
    const request = deferred<Response>();
    requests.push(request);
    return request.promise;
  });
  vi.stubGlobal("fetch", fetch);
  const setStatus = vi.fn();
  const setThreads = vi.fn<Dispatch<SetStateAction<ThreadCard[]>>>();
  const onHydrated = vi.fn();
  const hook = renderHook(() => ({
    history: useDeskHistory({ setStatus, setThreads, setActionBusy: vi.fn(), settings: DEFAULT_SETTINGS, onHydrated }, null),
    session: useSession(),
  }), { wrapper });
  return { ...hook, requests, fetch, setStatus, setThreads, onHydrated };
}

test.each([
  ["hydrateInteracted", "interactedHistory", "interactions"],
  ["hydrateSkipped", "skippedHistory", "skipped"],
  ["hydrateDismissed", "dismissedHistory", "dismissals"],
  ["hydrateExpired", "expiredHistory", "expired"],
] as const)("%s only commits the latest response", async (hydrate, state, field) => {
  const { result, requests } = setup();
  let first!: Promise<void>, latest!: Promise<void>;
  act(() => {
    first = result.current.history[hydrate]();
    latest = result.current.history[hydrate]();
  });
  await act(async () => { requests[1].resolve(response({ [field]: [row("new")] })); await latest; });
  await act(async () => { requests[0].resolve(response({ [field]: [row("old")] })); await first; });
  expect(result.current.history[state]).toEqual([row("new")]);
});

test.each([
  ["hydrateInteracted", "interacted", "interactions"],
  ["hydrateSkipped", "skipped", "skipped"],
  ["hydrateDismissed", "dismissed", "dismissals"],
] as const)("%s runs the hydrated callback once per current success, even with unchanged ids", async (hydrate, slice, field) => {
  const { result, requests, onHydrated } = setup();
  let first!: Promise<void>;
  act(() => { first = result.current.history[hydrate](); });
  await act(async () => { requests[0].resolve(response({ [field]: [row("same")] })); await first; });
  expect(onHydrated).toHaveBeenCalledTimes(1);
  expect(onHydrated).toHaveBeenLastCalledWith(slice);
  // Same ids again (a later revision from a note repair or webhook) still refreshes.
  let second!: Promise<void>;
  act(() => { second = result.current.history[hydrate](); });
  await act(async () => { requests[1].resolve(response({ [field]: [row("same")] })); await second; });
  expect(onHydrated).toHaveBeenCalledTimes(2);
  // A failed refresh does not.
  let failed!: Promise<void>;
  act(() => { failed = result.current.history[hydrate](); });
  await act(async () => { requests[2].resolve(new Response(null, { status: 500 })); await failed; });
  expect(onHydrated).toHaveBeenCalledTimes(2);
});

test("a stale interacted completion does not run the hydrated callback", async () => {
  const { result, requests, onHydrated } = setup();
  let first!: Promise<void>, latest!: Promise<void>;
  act(() => { first = result.current.history.hydrateInteracted(); latest = result.current.history.hydrateInteracted(); });
  await act(async () => { requests[1].resolve(response({ interactions: [row("new")] })); await latest; });
  expect(onHydrated).toHaveBeenCalledTimes(1);
  await act(async () => { requests[0].resolve(response({ interactions: [row("old")] })); await first; });
  expect(onHydrated).toHaveBeenCalledTimes(1);
});

test("an interacted completion uses the latest hydrated callback", async () => {
  const requests: ReturnType<typeof deferred<Response>>[] = [];
  vi.stubGlobal("fetch", vi.fn(() => {
    const request = deferred<Response>();
    requests.push(request);
    return request.promise;
  }));
  const first = vi.fn();
  const latest = vi.fn();
  const hook = renderHook(({ onHydrated }) => useDeskHistory({
    setStatus: vi.fn(), setThreads: vi.fn(), setActionBusy: vi.fn(),
    settings: DEFAULT_SETTINGS, onHydrated,
  }, null), { wrapper, initialProps: { onHydrated: first } });
  let pending!: Promise<void>;
  act(() => { pending = hook.result.current.hydrateInteracted(); });
  hook.rerender({ onHydrated: latest });
  await act(async () => { requests[0].resolve(response({ interactions: [] })); await pending; });
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledWith("interacted");
});

function setupSkipDismiss() {
  const requests: ReturnType<typeof deferred<Response>>[] = [];
  vi.stubGlobal("fetch", vi.fn(() => {
    const request = deferred<Response>();
    requests.push(request);
    return request.promise;
  }));
  const onActionSucceeded = vi.fn();
  const setStatus = vi.fn();
  const hook = renderHook(() => ({
    session: useSession(),
    actions: useSkipDismiss({
      setActionBusy: vi.fn(), setStatus, setThreads: vi.fn(), setExpandedId: vi.fn(),
      setSkippedHistory: vi.fn(), setDismissedHistory: vi.fn(),
      skippedIdsRef: { current: new Set<string>() }, dismissedIdsRef: { current: new Set<string>() },
      blockedConversationsRef: { current: new Set<string>() }, historyStaleRef: { current: false },
      onActionSucceeded,
    }),
  }), { wrapper });
  act(() => {
    const generation = hook.result.current.session.capture();
    hook.result.current.session.verify(authUser("owner-a"), true, generation);
  });
  return { ...hook, requests, onActionSucceeded, setStatus };
}

const card = { id: "card-1", author: "@a", text: "t", url: "https://x.com/a/status/1" } as ThreadCard;

test("skip success runs the action callback once; a failed skip does not", async () => {
  const { result, requests, onActionSucceeded } = setupSkipDismiss();
  let skip!: Promise<boolean>;
  act(() => { skip = result.current.actions.onSkip(card); });
  await act(async () => { requests[0].resolve(response({ ok: true })); });
  expect(await skip).toBe(true);
  expect(onActionSucceeded).toHaveBeenCalledTimes(1);
  act(() => { skip = result.current.actions.onSkip(card); });
  await act(async () => { requests[1].resolve(new Response("{}", { status: 500 })); });
  expect(await skip).toBe(false);
  expect(onActionSucceeded).toHaveBeenCalledTimes(1);
  act(() => { skip = result.current.actions.onSkip(card); });
  await act(async () => { requests[2].reject(new Error("offline")); });
  expect(await skip).toBe(false);
  expect(onActionSucceeded).toHaveBeenCalledTimes(1);
});

test("dismiss success runs the action callback once and a throwing callback cannot fail the action", async () => {
  const { result, requests, onActionSucceeded, setStatus } = setupSkipDismiss();
  onActionSucceeded.mockImplementation(() => { throw new Error("refresh exploded"); });
  act(() => { result.current.actions.openDismissModal(card); });
  let confirm!: Promise<void>;
  act(() => { confirm = result.current.actions.confirmDismiss(); });
  await act(async () => { requests[0].resolve(response({ ok: true })); await confirm; });
  expect(onActionSucceeded).toHaveBeenCalledTimes(1);
  expect(setStatus).toHaveBeenLastCalledWith("Marked @a not interested");
  expect(result.current.actions.dismissThread).toBeNull();
});

test("an action acknowledged after an account switch does not refresh the new account", async () => {
  const { result, requests, onActionSucceeded } = setupSkipDismiss();
  const old = result.current;
  let skip!: Promise<boolean>;
  act(() => { skip = old.actions.onSkip(card); });
  act(() => {
    const generation = old.session.capture();
    old.session.verify(authUser("owner-b"), true, generation);
  });
  await act(async () => { requests[0].resolve(response({ ok: true })); });
  expect(await skip).toBe(true);
  expect(onActionSucceeded).not.toHaveBeenCalled();
});

test("older completion cannot finish latest readiness or hide its failure", async () => {
  const { result, requests, setStatus } = setup();
  let first!: Promise<void>, latest!: Promise<void>;
  act(() => { first = result.current.history.hydrateInteracted(); latest = result.current.history.hydrateInteracted(); });
  await act(async () => { requests[0].resolve(response({ interactions: [row("old")] })); await first; });
  expect(result.current.history.interactedHydrated).toBe(false);
  await act(async () => { requests[1].resolve(new Response(null, { status: 500 })); await latest; });
  expect(result.current.history.interactedHydrated).toBe(true);
  expect(setStatus).toHaveBeenLastCalledWith("Could not refresh interacted history. Try again.");
  expect(result.current.history.interactedHistory).toEqual([]);
});

test("older failure cannot hide the latest interacted history", async () => {
  const { result, requests, setStatus } = setup();
  let first!: Promise<void>, latest!: Promise<void>;
  act(() => { first = result.current.history.hydrateInteracted(); latest = result.current.history.hydrateInteracted(); });
  await act(async () => { requests[1].resolve(response({ interactions: [row("new")] })); await latest; });
  await act(async () => { requests[0].resolve(new Response(null, { status: 500 })); await first; });
  expect(result.current.history.interactedHydrated).toBe(true);
  expect(result.current.history.interactedHistory).toEqual([row("new")]);
  expect(setStatus).not.toHaveBeenCalled();
});

test("latest failure is not replaced by an older success", async () => {
  const { result, requests, setStatus } = setup();
  let first!: Promise<void>, latest!: Promise<void>;
  act(() => { first = result.current.history.hydrateInteracted(); latest = result.current.history.hydrateInteracted(); });
  await act(async () => { requests[1].reject(new Error("offline")); await latest; });
  await act(async () => { requests[0].resolve(response({ interactions: [row("old")] })); await first; });
  expect(result.current.history.interactedHistory).toEqual([]);
  expect(setStatus).toHaveBeenCalledTimes(1);
});

test.each(["Skipped", "Dismissed"] as const)("refresh cannot wipe repeated local %s mutations", async (kind) => {
  const { result, requests } = setup();
  const hydrate = kind === "Skipped" ? "hydrateSkipped" : "hydrateDismissed";
  const setter = kind === "Skipped" ? "setSkippedHistory" : "setDismissedHistory";
  const state = kind === "Skipped" ? "skippedHistory" : "dismissedHistory";
  const ids = kind === "Skipped" ? "skippedIdsRef" : "dismissedIdsRef";
  for (let i = 0; i < 2; i++) {
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.history[hydrate]();
      result.current.history.historyStaleRef.current = true;
      result.current.history[ids].current.add(String(i));
      result.current.history[setter]([row(String(i))]);
    });
    await act(async () => { requests[i].resolve(response({})); await pending; });
    expect(result.current.history[state]).toEqual([row(String(i))]);
    expect(result.current.history[ids].current.has(String(i))).toBe(true);
  }
});

test.each(["invalidate", "unmount"] as const)("drops a response during JSON parsing after %s", async (end) => {
  const { result, requests, unmount, setThreads, setStatus } = setup();
  const body = deferred<unknown>();
  const old = result.current;
  let pending!: Promise<void>;
  act(() => { pending = old.history.hydrateInteracted(); });
  const pendingResponse = new Response();
  vi.spyOn(pendingResponse, "json").mockImplementation(() => body.promise);
  await act(async () => { requests[0].resolve(pendingResponse); });
  act(() => { if (end === "invalidate") old.session.invalidate("", false); else unmount(); });
  await act(async () => { body.resolve({ interactions: [row("late")], activeIds: ["late"] }); await pending; });
  expect(old.history.interactedIdsRef.current.size).toBe(0);
  expect(setThreads).not.toHaveBeenCalled();
  expect(setStatus).not.toHaveBeenCalled();
});

test("applyStripFromBoot still applies gamification after StrictMode replay", () => {
  sessionStorage.setItem("x-copilot-flight-path-open", "1");
  const { result } = renderHook(() => useActivityStrip(null), { wrapper });
  const gamification = { ...emptyGamificationStats(), lifetimeXp: 40 };
  act(() => {
    result.current.applyStripFromBoot({
      gamification,
      activityStats: emptyActivityStats("day"),
    });
  });
  expect(result.current.gamification).toEqual(gamification);
});

test("day/week/day and gamification retain the newest response", async () => {
  sessionStorage.setItem("x-copilot-flight-path-open", "1");
  const requests: ReturnType<typeof deferred<Response>>[] = [];
  vi.stubGlobal("fetch", vi.fn(() => { const d = deferred<Response>(); requests.push(d); return d.promise; }));
  const commits: unknown[] = [];
  const { result } = renderHook(() => useActivityStrip(null, (commit) => commits.push(commit)), { wrapper });
  act(() => {
    result.current.onActivityBucket("day");
    result.current.onActivityBucket("week");
    result.current.onActivityBucket("day");
  });
  const stats = { ...emptyActivityStats("day"), totals: { interactions: 3, originals: 1, quotes: 0, replies: 2, views: 30, withStats: 3 } };
  await act(async () => { requests[2].resolve(response(stats)); });
  await act(async () => { requests[1].resolve(response(emptyActivityStats("week"))); requests[0].resolve(response(emptyActivityStats("day"))); });
  expect(result.current.activityStats).toEqual(stats);
  let first!: Promise<void>, latest!: Promise<void>;
  act(() => { first = result.current.hydrateGamification(); latest = result.current.hydrateGamification(); });
  const gamification = { ...emptyGamificationStats(), lifetimeXp: 50 };
  await act(async () => { requests[4].resolve(response(gamification)); await latest; });
  await act(async () => { requests[3].resolve(response(emptyGamificationStats())); await first; });
  expect(result.current.gamification).toEqual(gamification);
  expect(commits).toEqual([
    { kind: "activityStats", value: stats },
    { kind: "gamification", value: gamification },
  ]);
});

test.each(["activity", "gamification"] as const)(
  "latest %s failure is not replaced by an older success",
  async (kind) => {
    const requests: ReturnType<typeof deferred<Response>>[] = [];
    vi.stubGlobal("fetch", vi.fn(() => { const d = deferred<Response>(); requests.push(d); return d.promise; }));
    const commits: unknown[] = [];
    const { result } = renderHook(() => useActivityStrip(null, (commit) => commits.push(commit)), { wrapper });
    let first!: Promise<void>, latest!: Promise<void>;
    act(() => {
      if (kind === "activity") {
        first = result.current.hydrateActivityStats();
        latest = result.current.hydrateActivityStats();
      } else {
        first = result.current.hydrateGamification();
        latest = result.current.hydrateGamification();
      }
    });
    await act(async () => { requests[1].resolve(new Response(null, { status: 500 })); await latest; });
    await act(async () => {
      requests[0].resolve(response(kind === "activity" ? emptyActivityStats("day") : emptyGamificationStats()));
      await first;
    });
    expect(commits).toEqual([]);
  },
);

test.each(["activity", "gamification"] as const)(
  "latest %s success is not replaced by an older failure",
  async (kind) => {
    const requests: ReturnType<typeof deferred<Response>>[] = [];
    vi.stubGlobal("fetch", vi.fn(() => { const d = deferred<Response>(); requests.push(d); return d.promise; }));
    const commits: unknown[] = [];
    const { result } = renderHook(() => useActivityStrip(null, (commit) => commits.push(commit)), { wrapper });
    let first!: Promise<void>, latest!: Promise<void>;
    act(() => {
      if (kind === "activity") {
        first = result.current.hydrateActivityStats();
        latest = result.current.hydrateActivityStats();
      } else {
        first = result.current.hydrateGamification();
        latest = result.current.hydrateGamification();
      }
    });
    const current = kind === "activity"
      ? emptyActivityStats("day")
      : { ...emptyGamificationStats(), lifetimeXp: 50 };
    await act(async () => { requests[1].resolve(response(current)); await latest; });
    await act(async () => { requests[0].resolve(new Response(null, { status: 500 })); await first; });
    expect(commits).toHaveLength(1);
  },
);

test("a refresh after a bucket toggle keeps the requested bucket", async () => {
  const requests: ReturnType<typeof deferred<Response>>[] = [];
  vi.stubGlobal("fetch", vi.fn(() => { const d = deferred<Response>(); requests.push(d); return d.promise; }));
  const { result } = renderHook(() => useActivityStrip(null), { wrapper });
  let refresh!: Promise<void>;
  act(() => {
    result.current.onActivityBucket("week");
    refresh = result.current.hydrateActivityStats();
  });
  await act(async () => {
    requests[1].resolve(response(emptyActivityStats("week")));
    await refresh;
  });
  await act(async () => {
    requests[0].resolve(response(emptyActivityStats("week")));
  });
  expect(result.current.activityBucket).toBe("week");
  expect(result.current.activityStats.bucket).toBe("week");
});

test("For You refresh ordering and local dismissal invalidate older snapshots", async () => {
  const { result, requests } = setup();
  const suggestion = { id: "suggestion", kind: "post", why: "test" };
  let first!: Promise<void>, latest!: Promise<void>;
  act(() => { first = result.current.history.hydrateForYou(); latest = result.current.history.hydrateForYou(); });
  await act(async () => { requests[1].resolve(response({ suggestions: [suggestion], tracked: 2 })); await latest; });
  await act(async () => { requests[0].resolve(response({ suggestions: [], tracked: 0 })); await first; });
  expect(result.current.history.forYouSuggestions[0].id).toBe("suggestion");
  expect(result.current.history.forYouProgress?.tracked).toBe(2);
  let refresh!: Promise<void>, dismiss!: Promise<boolean | "gone">;
  const replacement = { id: "replacement", kind: "post", why: "new" };
  act(() => { refresh = result.current.history.hydrateForYou(); dismiss = result.current.history.actForYou("suggestion", "dismiss"); });
  await act(async () => { requests[3].resolve(new Response(null, { status: 404 })); });
  await act(async () => { requests[4].resolve(response({ suggestions: [replacement] })); await dismiss; });
  expect(result.current.history.forYouSuggestions.map((row) => row.id)).toEqual([replacement.id]);
  await act(async () => { requests[2].resolve(response({ suggestions: [suggestion] })); await refresh; });
  expect(result.current.history.forYouSuggestions.map((row) => row.id)).toEqual([replacement.id]);
});

test("successful For You mutation invalidates an older refresh", async () => {
  const { result, requests } = setup();
  let hydrate!: Promise<void>;
  let action!: Promise<boolean | "gone">;
  act(() => {
    hydrate = result.current.history.hydrateForYou();
    action = result.current.history.actForYou("suggestion", "done");
  });
  await act(async () => { requests[1].resolve(response({ suggestions: [] })); await action; });
  await act(async () => { requests[0].resolve(response({ suggestions: [{ id: "suggestion", kind: "post", why: "test" }] })); await hydrate; });
  expect(result.current.history.forYouSuggestions).toEqual([]);
});

test("404 For You done mutation invalidates an older refresh", async () => {
  const { result, requests } = setup();
  let initial!: Promise<void>;
  act(() => { initial = result.current.history.hydrateForYou(); });
  await act(async () => {
    requests[0].resolve(response({ suggestions: [{ id: "suggestion", kind: "post", why: "test" }] }));
    await initial;
  });

  let refresh!: Promise<void>;
  let action!: Promise<boolean | "gone">;
  act(() => {
    refresh = result.current.history.hydrateForYou();
    action = result.current.history.actForYou("suggestion", "done");
  });
  await act(async () => { requests[2].resolve(new Response(null, { status: 404 })); await action; });
  await act(async () => {
    requests[1].resolve(response({ suggestions: [{ id: "suggestion", kind: "post", why: "restored" }] }));
    await refresh;
  });

  expect(result.current.history.forYouSuggestions).toEqual([]);
});

test.each(["hydrateInteracted", "hydrateSkipped", "hydrateDismissed", "hydrateExpired", "hydrateForYou"] as const)(
  "%s does not parse or launch work after session invalidation", async (hydrate) => {
    const { result, requests, fetch } = setup();
    const old = result.current;
    let pending!: Promise<void>;
    act(() => { pending = old.history[hydrate](); old.session.invalidate("", false); });
    const pendingResponse = new Response();
    const json = vi.spyOn(pendingResponse, "json");
    await act(async () => { requests[0].resolve(pendingResponse); await pending; await old.history[hydrate](); });
    expect(json).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test("chart and gamification ignore session-expired results and subsequent refreshes", async () => {
  sessionStorage.setItem("x-copilot-flight-path-open", "1");
  const requests: ReturnType<typeof deferred<Response>>[] = [];
  const fetch = vi.fn(() => {
    const request = deferred<Response>();
    requests.push(request);
    return request.promise;
  });
  vi.stubGlobal("fetch", fetch);
  const gamificationCommits: number[] = [];
  const { result } = renderHook(() => ({
    strip: useActivityStrip(null, (commit) => {
      if (commit.kind === "gamification") gamificationCommits.push(commit.value.lifetimeXp);
    }),
    session: useSession(),
  }), { wrapper });
  const old = result.current;
  let chart!: Promise<void>, gamification!: Promise<void>;
  act(() => {
    chart = old.strip.hydrateActivityStats();
    gamification = old.strip.hydrateGamification();
    old.session.invalidate("", false);
  });
  await act(async () => {
    requests[0].resolve(response(emptyActivityStats("day")));
    requests[1].resolve(response({ ...emptyGamificationStats(), lifetimeXp: 99 }));
    await Promise.all([chart, gamification]);
    await old.strip.hydrateActivityStats();
    await old.strip.hydrateGamification();
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(gamificationCommits).not.toContain(99);
});

test("chart and gamification ignore results after unmount", async () => {
  sessionStorage.setItem("x-copilot-flight-path-open", "1");
  const requests: ReturnType<typeof deferred<Response>>[] = [];
  vi.stubGlobal("fetch", vi.fn(() => { const d = deferred<Response>(); requests.push(d); return d.promise; }));
  const commits: unknown[] = [];
  const { result, unmount } = renderHook(
    () => useActivityStrip(null, (commit) => commits.push(commit)),
    { wrapper },
  );
  const old = result.current;
  let chart!: Promise<void>, gamification!: Promise<void>;
  act(() => {
    chart = old.hydrateActivityStats();
    gamification = old.hydrateGamification();
    unmount();
  });
  await act(async () => {
    requests[0].resolve(response(emptyActivityStats("day")));
    requests[1].resolve(response({ ...emptyGamificationStats(), lifetimeXp: 99 }));
    await Promise.all([chart, gamification]);
  });
  expect(commits).toEqual([]);
});


test("Scout lock transfers synchronously and stale refresh keeps the new preserved id", async () => {
  const { result, requests, setThreads } = setup();
  let threads: ThreadCard[] = [{ ...card, id: "A" }, { ...card, id: "B" }];
  setThreads.mockImplementation((update) => { threads = typeof update === "function" ? update(threads) : update; });
  let first!: Promise<void>, latest!: Promise<void>;
  act(() => {
    result.current.history.interactedIdsRef.current.add("A");
    first = result.current.history.hydrateInteracted("A");
    expect(threads.map((t) => t.id)).toEqual(["A", "B"]);
    latest = result.current.history.hydrateInteracted("B");
    expect(threads.map((t) => t.id)).toEqual(["B"]);
  });
  await act(async () => { requests[1].resolve(response({ activeIds: ["B"] })); await latest; });
  await act(async () => { requests[0].resolve(response({ activeIds: ["A"], interactions: [row("A")] })); await first; });
  expect(result.current.history.interactedIdsRef.current).toEqual(new Set(["B"]));
  expect(threads.map((t) => t.id)).toEqual(["B"]);
});
