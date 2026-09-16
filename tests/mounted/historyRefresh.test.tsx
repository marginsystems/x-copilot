import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SessionBoundary, useSession } from "../../src/auth/session";
import { useDeskHistory } from "../../src/desk/useDeskHistory";
import { useActivityStrip } from "../../src/desk/useActivityStrip";
import type { ThreadCard } from "../../src/desk/types";
import type { AppSettings } from "../../src/lib/settings";
import { emptyActivityStats } from "../../src/lib/activityStats";
import { emptyGamificationStats } from "../../src/lib/gamification";
import { deferred } from "./support/deferred";

function wrapper({ children }: { children: ReactNode }) {
  return <StrictMode><SessionBoundary>{children}</SessionBoundary></StrictMode>;
}
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
  const setThreads = vi.fn();
  const hook = renderHook(() => ({
    history: useDeskHistory({ setStatus, setThreads, setActionBusy: vi.fn(), settings: {} as AppSettings }, null),
    session: useSession(),
  }), { wrapper });
  return { ...hook, requests, fetch, setStatus, setThreads };
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
  await act(async () => { requests[0].resolve({ ok: true, json: () => body.promise } as Response); });
  act(() => { if (end === "invalidate") old.session.invalidate("", false); else unmount(); });
  await act(async () => { body.resolve({ interactions: [row("late")], activeIds: ["late"] }); await pending; });
  expect(old.history.interactedIdsRef.current.size).toBe(0);
  expect(setThreads).not.toHaveBeenCalled();
  expect(setStatus).not.toHaveBeenCalled();
});

test("day/week/day and gamification retain the newest response", async () => {
  sessionStorage.setItem("x-copilot-flight-path-open", "1");
  const requests: ReturnType<typeof deferred<Response>>[] = [];
  vi.stubGlobal("fetch", vi.fn(() => { const d = deferred<Response>(); requests.push(d); return d.promise; }));
  const { result } = renderHook(() => useActivityStrip(null), { wrapper });
  act(() => {
    result.current.onActivityBucket("day");
    result.current.onActivityBucket("week");
    result.current.onActivityBucket("day");
  });
  const stats = { ...emptyActivityStats("day"), totals: { interactions: 3, views: 30, withStats: 3 } };
  await act(async () => { requests[2].resolve(response(stats)); });
  await act(async () => { requests[1].resolve(response(emptyActivityStats("week"))); requests[0].resolve(response(emptyActivityStats("day"))); });
  expect(result.current.activityStats).toEqual(stats);
  let first!: Promise<void>, latest!: Promise<void>;
  act(() => { first = result.current.hydrateGamification(); latest = result.current.hydrateGamification(); });
  const gamification = { ...emptyGamificationStats(), lifetimeXp: 50 };
  await act(async () => { requests[4].resolve(response(gamification)); await latest; });
  await act(async () => { requests[3].resolve(response(emptyGamificationStats())); await first; });
  expect(result.current.gamification).toEqual(gamification);
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
  let refresh!: Promise<void>, dismiss!: Promise<boolean>;
  act(() => { refresh = result.current.history.hydrateForYou(); dismiss = result.current.history.actForYou("suggestion", "dismiss"); });
  await act(async () => { requests[3].resolve(response({ suggestions: [] })); await dismiss; });
  await act(async () => { requests[2].resolve(response({ suggestions: [suggestion] })); await refresh; });
  expect(result.current.history.forYouSuggestions).toEqual([]);
});

test.each(["hydrateInteracted", "hydrateSkipped", "hydrateDismissed", "hydrateExpired", "hydrateForYou"] as const)(
  "%s does not parse or launch work after session invalidation", async (hydrate) => {
    const { result, requests, fetch } = setup();
    const old = result.current;
    let pending!: Promise<void>;
    act(() => { pending = old.history[hydrate](); old.session.invalidate("", false); });
    const json = vi.fn();
    await act(async () => { requests[0].resolve({ ok: true, json } as unknown as Response); await pending; await old.history[hydrate](); });
    expect(json).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test("chart and gamification ignore session-expired results and subsequent refreshes", async () => {
  sessionStorage.setItem("x-copilot-flight-path-open", "1");
  const pending = deferred<Response>();
  const fetch = vi.fn(() => pending.promise);
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => ({ strip: useActivityStrip(null), session: useSession() }), { wrapper });
  const old = result.current;
  let chart!: Promise<void>, gamification!: Promise<void>;
  act(() => {
    chart = old.strip.hydrateActivityStats();
    gamification = old.strip.hydrateGamification();
    old.session.invalidate("", false);
  });
  await act(async () => {
    pending.resolve(response({ ...emptyActivityStats("day"), ...emptyGamificationStats(), lifetimeXp: 99 }));
    await Promise.all([chart, gamification]);
    await old.strip.hydrateActivityStats();
    await old.strip.hydrateGamification();
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.current.strip.gamification.lifetimeXp).toBe(0);
});


test("Scout lock transfers synchronously and stale refresh keeps the new preserved id", async () => {
  const { result, requests, setThreads } = setup();
  let threads = [{ id: "A" }, { id: "B" }] as ThreadCard[];
  setThreads.mockImplementation((update) => { threads = update(threads); });
  let first!: Promise<void>, latest!: Promise<void>;
  act(() => {
    result.current.history.interactedIdsRef.current.add("A");
    first = result.current.history.hydrateInteracted("A");
    expect(threads.map((t) => t.id)).toEqual(["A", "B"]);
    latest = result.current.history.hydrateInteracted("B");
    expect(threads.map((t) => t.id)).toEqual(["B"]);
  });
  await act(async () => { requests[1].resolve(response({ activeIds: ["B"] })); await latest; });
  await act(async () => { requests[0].resolve(response({ activeIds: ["A"] })); await first; });
  expect(threads.map((t) => t.id)).toEqual(["B"]);
  expect(result.current.history.keepInCurated({ id: "B" } as ThreadCard)).toBe(true);
});
