import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SessionBoundary, useSession } from "../../src/auth/session";
import { useDeskBoot } from "../../src/desk/useDeskBoot";
import { useScoutRun } from "../../src/desk/useScoutRun";
import { parseDeskBoot, peekDeskBootCache } from "../../src/lib/deskBoot";
import { DEFAULT_SETTINGS } from "../../src/lib/settings";
import { deferred } from "./support/deferred";

vi.mock("../../src/desk/watch", () => ({
  ensureActivitySubscribe: vi.fn(), watchDeskThreads: vi.fn(),
}));

const boot = parseDeskBoot({ ok: true, user: { id: "owner", onboardingCompleted: true }, desk: {} })!;
const wrapper = ({ children }: { children: ReactNode }) => <StrictMode><SessionBoundary>{children}</SessionBoundary></StrictMode>;
afterEach(() => window.history.replaceState({}, "", "/"));

function mountBoot(strict = false) {
  const applyDesk = vi.fn();
  const followup = vi.fn(async () => {});
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
      loadUsage: followup, loadAdmin: followup,
    });
    return { ...state, session };
  }, { wrapper: strict ? wrapper : SessionBoundary });
  return { ...hook, applyDesk, followup, notice };
}

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

test("stalled fallback releases readiness, aborts reads, and suppresses late data", async () => {
  vi.useFakeTimers();
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
  expect(signals.length).toBe(9);
  await act(async () => { vi.advanceTimersByTime(24000); });
  expect(h.result.current.deskBootReady).toBe(true);
  expect(h.notice).toHaveBeenLastCalledWith("Desk loading timed out. Reload to try again.");
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
      pollingEnabled: enabled, agenda: "", settings: DEFAULT_SETTINGS,
      authUser: boot.user, billing: null, threadCount: 0, setThreads,
      setStatus: vi.fn(), keepInCurated: () => true,
      hydrateInteracted: vi.fn(async () => {}), loadBilling: vi.fn(async () => {}),
      hydrateAuth: vi.fn(async () => boot.user),
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

test("a full tank stops polling and aborts its effect", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => Response.json({ ok: true, empty: false, snapshot: { threads: [{ id: "a" }, { id: "b" }] } }));
  vi.stubGlobal("fetch", fetcher);
  const h = mountPoll();
  act(() => h.result.current.applyLastScoutFromBoot({ ok: true, empty: true }));
  await act(async () => {});
  expect((fetcher.mock.calls as unknown as [string, RequestInit][])[0][1].signal!.aborted).toBe(true);
  await act(async () => { vi.advanceTimersByTime(16000); });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
