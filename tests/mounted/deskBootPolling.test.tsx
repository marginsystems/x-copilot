import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SESSION_RESET_KEY, SessionBoundary, useSession } from "../../src/auth/session";
import { useDeskBoot } from "../../src/desk/useDeskBoot";
import { useDeskHistory } from "../../src/desk/useDeskHistory";
import { useScoutRun } from "../../src/desk/useScoutRun";
import { parseDeskBoot, peekDeskBootCache } from "../../src/lib/deskBoot";
import { DEFAULT_SETTINGS } from "../../src/lib/settings";
import { deferred } from "./support/deferred";

vi.mock("../../src/desk/watch", () => ({
  ensureActivitySubscribe: vi.fn(), watchDeskThreads: vi.fn(),
}));

const boot = parseDeskBoot({ ok: true, user: { id: "owner", onboardingCompleted: true }, desk: {} })!;
const wrapper = ({ children }: { children: ReactNode }) => <StrictMode><SessionBoundary>{children}</SessionBoundary></StrictMode>;
const threadCard = (id: string) => ({ id, author: "@author", text: "text", url: `https://x.com/author/status/${id}` });
afterEach(() => window.history.replaceState({}, "", "/"));

function mountBoot(strict = false) {
  const applyDesk = vi.fn();
  const followup = vi.fn(async () => {});
  const familiarity = vi.fn(async () => {});
  const notice = vi.fn();
  const hook = renderHook(() => {
    const session = useSession();
    const generation = session.capture();
    const state = useDeskBoot({
      dedupeAccounts: true, setAgenda: vi.fn(), setAuthNotice: notice,
      setBillingNotice: vi.fn(), setView: vi.fn(), setSignInOpen: vi.fn(),
      applyAuthUser: (user, required = true) => session.verify(user, required, generation),
      applyDesk, confirmCheckout: followup, hydrateCoaching: followup,
      hydrateActivityStats: followup, loadBilling: followup, hydrateVoice: followup,
      loadUsage: followup, loadAdmin: followup, hydrateScoutFamiliarity: familiarity,
    });
    return { ...state, session };
  }, { wrapper: strict ? wrapper : SessionBoundary });
  return { ...hook, applyDesk, followup, familiarity, notice };
}

const familiarityFixture = {
  state: "learning", version: 1, revision: 2, score: 0,
  coverage: { storedConfirmedReplies: 1, knownKindResolvedActions: 1 },
  biases: [], hints: [],
  lastLearned: { at: "2026-09-20T10:00:01.000Z", action: "take", threadKind: "fact_add" },
  updatedAt: "2026-09-20T10:00:01.000Z",
};

test("StrictMode cancels the first boot and preserves checkout for the replay", async () => {
  window.history.replaceState({}, "", "/?checkout=success&session_id=checkout-id");
  const first = deferred<Response>();
  const second = deferred<Response>();
  const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  vi.stubGlobal("fetch", fetcher);
  const h = mountBoot(true);
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { first.resolve(Response.json(boot)); });
  expect(h.applyDesk).not.toHaveBeenCalled();
  expect(h.followup).not.toHaveBeenCalled();
  expect(peekDeskBootCache("owner")).toBeNull();
  await act(async () => { second.resolve(Response.json(boot)); });
  expect(h.applyDesk).toHaveBeenCalledTimes(1);
  expect(h.followup).toHaveBeenCalledWith("checkout-id");
  expect(h.result.current.deskBootReady).toBe(true);
});

test("logout aborts boot and a late response cannot cache or confirm checkout", async () => {
  window.history.replaceState({}, "", "/?checkout=success&session_id=id");
  const pending = deferred<Response>();
  const fetcher = vi.fn(() => pending.promise);
  vi.stubGlobal("fetch", fetcher);
  const h = mountBoot();
  const signal = (fetcher.mock.calls as unknown as [string, RequestInit][])[0][1].signal!;
  act(() => { h.result.current.session.invalidate(); });
  expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve(Response.json(boot)); });
  expect(h.applyDesk).not.toHaveBeenCalled();
  expect(h.followup).not.toHaveBeenCalled();
  expect(peekDeskBootCache("owner")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("an invalid optional profile body does not abort fallback boot", async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes("/api/boot?")) return new Response(null, { status: 404 });
    if (url.endsWith("/api/auth/me")) return Response.json(boot);
    if (url.endsWith("/api/scout/profile")) return new Response("<html>");
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetcher);
  const h = mountBoot();
  await act(async () => {});
  expect(h.applyDesk).toHaveBeenCalledTimes(1);
  expect(h.result.current.deskBootReady).toBe(true);
  expect(h.notice).not.toHaveBeenCalledWith("Desk could not load. Reload to try again.");
});

test("stalled fallback releases readiness, aborts reads, and suppresses late data", async () => {
  vi.useFakeTimers();
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  const stalled = deferred<Response>();
  const signals: AbortSignal[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
    signals.push(init.signal!);
    if (url.includes("/api/boot?")) return Promise.resolve(new Response(null, { status: 404 }));
    if (url.endsWith("/api/auth/me")) return Promise.resolve(Response.json(boot));
    return stalled.promise;
  }));
  const h = mountBoot();
  await act(async () => {});
  expect(signals.length).toBe(10);
  await act(async () => { vi.advanceTimersByTime(24000); });
  expect(h.result.current.deskBootReady).toBe(true);
  expect(h.notice).toHaveBeenLastCalledWith("Desk loading timed out. Reload to try again.");
  expect(setItem).not.toHaveBeenCalledWith(SESSION_RESET_KEY, expect.any(String));
  setItem.mockRestore();
  expect(signals.every(signal => signal.aborted)).toBe(true);
  await act(async () => { stalled.resolve(Response.json({})); });
  expect(h.applyDesk).not.toHaveBeenCalled();
  expect(h.followup).not.toHaveBeenCalled();
  h.unmount();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(boot)));
  const retry = mountBoot();
  await act(async () => {});
  expect(retry.applyDesk).toHaveBeenCalledTimes(1);
});

test.each(["boot", "fallback auth", "fallback desk"])("expired %s stops boot", async (where) => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes("/api/boot?") && where !== "boot") return new Response(null, { status: 404 });
    if (url.endsWith("/api/auth/me") && where === "fallback desk") return Response.json(boot);
    return new Response(null, { status: 401 });
  });
  vi.stubGlobal("fetch", fetcher);
  const h = mountBoot();
  await act(async () => {});
  expect(h.result.current.session.getSnapshot().active).toBe(false);
  expect(h.applyDesk).not.toHaveBeenCalled();
  expect(h.followup).not.toHaveBeenCalled();
  if (where !== "fallback desk") expect(fetcher).toHaveBeenCalledTimes(where === "boot" ? 1 : 2);
});

function mountPoll(enabled = true) {
  const setThreads = vi.fn();
  const hook = renderHook(({ enabled }) => {
    const session = useSession();
    const scout = useScoutRun({
      pollingEnabled: enabled, settings: DEFAULT_SETTINGS,
      threadCount: 0, setThreads,
      setStatus: vi.fn(), keepInCurated: () => true,
    });
    return { ...scout, session };
  }, { wrapper, initialProps: { enabled } });
  return { ...hook, setThreads };
}

test.each(["disable", "logout", "unmount"])("poll %s aborts response-body work and stops scheduling", async (action) => {
  vi.useFakeTimers();
  const body = deferred<unknown>();
  const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: () => body.promise }));
  vi.stubGlobal("fetch", fetcher);
  const h = mountPoll(false);
  act(() => h.result.current.applyLastScoutFromBoot({ ok: true, empty: true }));
  expect(fetcher).not.toHaveBeenCalled();
  h.rerender({ enabled: true });
  await act(async () => {});
  const signal = (fetcher.mock.calls as unknown as [string, RequestInit][])[0][1].signal!;
  h.setThreads.mockClear();
  if (action === "disable") h.rerender({ enabled: false });
  else if (action === "logout") act(() => { h.result.current.session.invalidate(); });
  else h.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { body.resolve({ ok: true, empty: true }); vi.advanceTimersByTime(16000); });
  expect(h.setThreads).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("poll 401 expires the session and stops autoStart requests", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => new Response(null, { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  const h = mountPoll();
  act(() => h.result.current.applyLastScoutFromBoot({ ok: true, empty: true }));
  await act(async () => {});
  expect(h.result.current.session.getSnapshot().active).toBe(false);
  await act(async () => { vi.advanceTimersByTime(16000); });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("invalid empty snapshots still apply flight state and start polling", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: () => ({ ok: true, empty: true }) }));
  vi.stubGlobal("fetch", fetcher);
  const h = mountPoll(false);
  act(() => h.result.current.applyLastScoutFromBoot({
    ok: false,
    empty: true,
    flight: { active: true, stage: "searching" },
  }));
  expect(h.result.current.searching).toBe(true);
  h.rerender({ enabled: true });
  await act(async () => {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toContain("autoStart=1");
  h.unmount();
});

test("poll does not overlap while the response body is pending", async () => {
  vi.useFakeTimers();
  const body = deferred<unknown>();
  const fetcher = vi.fn(async (_input: RequestInfo | URL) => ({ ok: true, status: 200, json: () => body.promise }));
  vi.stubGlobal("fetch", fetcher);
  const h = mountPoll();
  act(() => h.result.current.applyLastScoutFromBoot({ ok: true, empty: true }));
  await act(async () => {});
  await act(async () => { vi.advanceTimersByTime(8000); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toContain("autoStart=1");
  h.unmount();
  await act(async () => { body.resolve({ ok: true, empty: true }); });
});

test("poll fallback timeout releases a stalled response without AbortSignal.any", async () => {
  vi.useFakeTimers();
  const originalAny = Object.getOwnPropertyDescriptor(AbortSignal, "any");
  Object.defineProperty(AbortSignal, "any", { configurable: true, value: undefined });
  try {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const signal = init.signal!;
      signals.push(signal);
      return {
        ok: true,
        status: 200,
        json: () => new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        }),
      };
    });
    vi.stubGlobal("fetch", fetcher);
    const h = mountPoll();
    act(() => h.result.current.applyLastScoutFromBoot({ ok: true, empty: true }));
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(12000); });
    expect(signals[0].aborted).toBe(true);
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    h.unmount();
  } finally {
    if (originalAny) Object.defineProperty(AbortSignal, "any", originalAny);
    else Reflect.deleteProperty(AbortSignal, "any");
  }
});

test("fallback commits one complete desk without starting collection", async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes("/api/boot?")) return new Response(null, { status: 404 });
    if (url.endsWith("/api/auth/me")) return Response.json(boot);
    return Response.json({ ok: true, interactions: [{ threadId: "hidden", author: "a", at: "now" }], activeIds: ["hidden"] });
  });
  vi.stubGlobal("fetch", fetcher);
  const h = mountBoot();
  await act(async () => {});
  expect(h.result.current.deskBootReady).toBe(true);
  expect(h.applyDesk).toHaveBeenCalledTimes(1);
  expect(h.applyDesk.mock.calls[0][0].interacted.activeIds).toEqual(["hidden"]);
  expect(fetcher.mock.calls.some(([url]) => url.includes("autoStart=0"))).toBe(true);
  expect(fetcher.mock.calls.some(([url]) => url.includes("autoStart=1"))).toBe(false);
});

test("unverified fallback timeout ends checking without enabling an anonymous session", async () => {
  vi.useFakeTimers();
  const pending = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("/api/boot?")
    ? Promise.resolve(new Response(null, { status: 404 })) : pending.promise));
  const h = mountBoot();
  await act(async () => {});
  await act(async () => { vi.advanceTimersByTime(24000); });
  expect(h.result.current.session.getSnapshot()).toMatchObject({ checked: true, active: false, user: null });
  expect(h.result.current.session.getSnapshot().notice).toContain("Reload to try again");
  await act(async () => { pending.resolve(Response.json(boot)); });
  expect(h.applyDesk).not.toHaveBeenCalled();
});

test("auth-optional fallback 401 does not invalidate the session", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/api/boot?")) return new Response(null, { status: 404 });
    if (url.endsWith("/api/auth/me")) {
      return Response.json(
        { ok: false, error: "unauthenticated", authRequired: false },
        { status: 401 },
      );
    }
    if (url.endsWith("/api/for-you")) return new Response(null, { status: 401 });
    return Response.json({ ok: true });
  }));
  const h = mountBoot();
  await act(async () => {});
  expect(h.result.current.session.getSnapshot()).toMatchObject({
    checked: true,
    active: true,
    required: false,
    user: null,
  });
  expect(h.result.current.deskBootReady).toBe(true);
  expect(h.applyDesk).toHaveBeenCalledTimes(1);
});

test("fallback auth failure releases readiness after the session was checked", async () => {
  const auth = deferred<Response>();
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/api/boot?")) return new Response(null, { status: 404 });
    return auth.promise;
  }));
  const h = mountBoot();
  await act(async () => {});
  act(() => {
    const generation = h.result.current.session.capture();
    h.result.current.session.verify(boot.user, true, generation);
  });
  await act(async () => { auth.resolve(new Response(null, { status: 500 })); });
  expect(h.result.current.deskBootReady).toBe(true);
  expect(h.result.current.agendaReady).toBe(true);
  expect(h.notice).toHaveBeenLastCalledWith("Desk could not load. Reload to try again.");
  expect(setItem).not.toHaveBeenCalledWith(SESSION_RESET_KEY, expect.any(String));
  setItem.mockRestore();
});

test("fallback keeps history when one later slice is down", async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes("/api/boot?")) return new Response(null, { status: 404 });
    if (url.endsWith("/api/auth/me")) return Response.json(boot);
    if (url.endsWith("/api/gamification")) return new Response(null, { status: 500 });
    if (url.endsWith("/api/interacted")) {
      return Response.json({
        ok: true,
        interactions: [{ threadId: "kept", author: "a", at: "now" }],
        activeIds: ["kept"],
      });
    }
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetcher);
  const h = mountBoot();
  await act(async () => {});
  expect(h.result.current.deskBootReady).toBe(true);
  expect(h.applyDesk).toHaveBeenCalledTimes(1);
  expect(h.applyDesk.mock.calls[0][0].interacted.activeIds).toEqual(["kept"]);
  expect(h.applyDesk.mock.calls[0][0].gamification).toBeUndefined();
  expect(h.applyDesk.mock.calls[0][0].activityStats).toBeUndefined();
  expect(h.applyDesk.mock.calls[0][0].coaching).toBeUndefined();
});

test("boot with the familiarity slice applies it and schedules no post-paint refresh", async () => {
  const payload = { ...boot, desk: { scoutFamiliarity: familiarityFixture } };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
  const h = mountBoot();
  await act(async () => {});
  expect(h.result.current.deskBootReady).toBe(true);
  expect(h.applyDesk).toHaveBeenCalledTimes(1);
  expect(h.applyDesk.mock.calls[0][0].scoutFamiliarity).toEqual(familiarityFixture);
  expect(peekDeskBootCache("owner")?.desk?.scoutFamiliarity).toEqual(familiarityFixture);
  expect(h.familiarity).not.toHaveBeenCalled();
});

test.each(["absent", "null"] as const)("boot with %s familiarity still paints; only the absent case refreshes once after paint", async (shape) => {
  const payload = shape === "absent" ? boot : { ...boot, desk: { scoutFamiliarity: null } };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
  const h = mountBoot();
  await act(async () => {});
  expect(h.result.current.deskBootReady).toBe(true);
  expect(h.applyDesk).toHaveBeenCalledTimes(1);
  const applied = h.applyDesk.mock.calls[0][0];
  if (shape === "absent") {
    expect("scoutFamiliarity" in applied).toBe(false);
    expect(h.familiarity).toHaveBeenCalledTimes(1);
  } else {
    expect(applied.scoutFamiliarity).toBeNull();
    expect(h.familiarity).not.toHaveBeenCalled();
  }
  expect(h.result.current.session.getSnapshot().user?.id).toBe("owner");
});

test("fallback reads the profile endpoint after auth and commits it with the desk", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    if (url.includes("/api/boot?")) return new Response(null, { status: 404 });
    if (url.endsWith("/api/auth/me")) return Response.json(boot);
    if (url.endsWith("/api/scout/profile")) return Response.json({ ok: true, scoutFamiliarity: familiarityFixture });
    return Response.json({ ok: true });
  }));
  const h = mountBoot();
  await act(async () => {});
  expect(h.result.current.deskBootReady).toBe(true);
  const profileAt = urls.findIndex((url) => url.endsWith("/api/scout/profile"));
  const authAt = urls.findIndex((url) => url.endsWith("/api/auth/me"));
  expect(profileAt).toBeGreaterThan(authAt);
  expect(h.applyDesk).toHaveBeenCalledTimes(1);
  expect(h.applyDesk.mock.calls[0][0].scoutFamiliarity).toEqual(familiarityFixture);
  expect(h.familiarity).not.toHaveBeenCalled();
});

test.each([404, 500, "malformed"] as const)("fallback profile %s does not block readiness or sibling slices", async (outcome) => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/api/boot?")) return new Response(null, { status: 404 });
    if (url.endsWith("/api/auth/me")) return Response.json(boot);
    if (url.endsWith("/api/scout/profile")) {
      return outcome === "malformed"
        ? Response.json({ ok: true, scoutFamiliarity: { state: "supported", score: 500 } })
        : new Response(null, { status: outcome });
    }
    if (url.endsWith("/api/interacted")) {
      return Response.json({ ok: true, interactions: [{ threadId: "kept", author: "a", at: "now" }], activeIds: ["kept"] });
    }
    return Response.json({ ok: true });
  }));
  const h = mountBoot();
  await act(async () => {});
  expect(h.result.current.deskBootReady).toBe(true);
  expect(h.applyDesk).toHaveBeenCalledTimes(1);
  const applied = h.applyDesk.mock.calls[0][0];
  expect(applied.interacted.activeIds).toEqual(["kept"]);
  if (outcome === "malformed") expect(applied.scoutFamiliarity).toBeNull();
  else expect("scoutFamiliarity" in applied).toBe(false);
  expect(h.familiarity).not.toHaveBeenCalled();
  expect(h.result.current.session.getSnapshot().active).toBe(true);
});

test("fallback profile 401 under required auth still resets the session", async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes("/api/boot?")) return new Response(null, { status: 404 });
    if (url.endsWith("/api/auth/me")) return Response.json(boot);
    if (url.endsWith("/api/scout/profile")) return new Response(null, { status: 401 });
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetcher);
  const h = mountBoot();
  await act(async () => {});
  expect(h.result.current.session.getSnapshot().active).toBe(false);
  expect(h.applyDesk).not.toHaveBeenCalled();
  expect(h.familiarity).not.toHaveBeenCalled();
});

test("applyHistoryFromBoot marks interacted history hydrated", () => {
  const { result } = renderHook(
    () =>
      useDeskHistory(
        {
          setStatus: vi.fn(),
          setThreads: vi.fn(),
          setActionBusy: vi.fn(),
          settings: DEFAULT_SETTINGS,
        },
        null,
      ),
    { wrapper },
  );
  expect(result.current.interactedHydrated).toBe(false);
  act(() => {
    result.current.applyHistoryFromBoot(boot.desk!);
  });
  expect(result.current.interactedHydrated).toBe(true);
});

test("a full tank stops polling and aborts its effect", async () => {
  vi.useFakeTimers();
  const threads = [threadCard("a"), threadCard("b")];
  const fetcher = vi.fn(async () => Response.json({ ok: true, empty: false, snapshot: { threads } }));
  vi.stubGlobal("fetch", fetcher);
  const h = mountPoll();
  act(() => h.result.current.applyLastScoutFromBoot({ ok: true, empty: true }));
  h.setThreads.mockClear();
  await act(async () => {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(16000); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(h.setThreads).toHaveBeenCalledWith(threads);
});

test.each([
  { name: "active flight", empty: false, active: true, threads: [threadCard("a"), threadCard("b")], expected: [threadCard("a"), threadCard("b")] },
  { name: "explicitly empty tank", empty: true, active: false, threads: [threadCard("a"), threadCard("b")], expected: [] },
  { name: "low tank", empty: false, active: false, threads: [{ id: "invalid" }], expected: null },
])("$name keeps polling after card validation", async ({ empty, active, threads, expected }) => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => Response.json({
    ok: true, empty, flight: { active }, snapshot: { threads },
  }));
  vi.stubGlobal("fetch", fetcher);
  const h = mountPoll();
  act(() => h.result.current.applyLastScoutFromBoot({ ok: true, empty: true }));
  h.setThreads.mockClear();
  await act(async () => {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(h.result.current.searching).toBe(active);
  await act(async () => { vi.advanceTimersByTime(4000); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  if (expected) {
    expect(h.setThreads).toHaveBeenCalledWith(expected);
  } else {
    expect(h.setThreads).not.toHaveBeenCalled();
  }
});
