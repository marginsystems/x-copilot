import { useState } from "react";
import { act, render, renderHook, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { createSession, SessionBoundary, SESSION_RESET_KEY, useSession } from "../../src/auth/session";
import { useAuthSession } from "../../src/auth/useAuthSession";
import { useDeskBoot } from "../../src/desk/useDeskBoot";
import { peekDeskBootCache, writeDeskBootCache, type DeskBootPayload } from "../../src/lib/deskBoot";
import type { AuthSessionUser } from "../../src/auth/types";
import { deferred } from "./support/deferred";

const owner = (id: string): AuthSessionUser => ({ id, email: null, displayName: id, avatarUrl: null, onboardingCompleted: true, agenda: null, xUsername: null, xLinked: true, xCanPost: true, isAdmin: false });
const payload = (id: string): DeskBootPayload => ({ ok: true, user: owner(id), authRequired: true, desk: null });
function useHarness() {
  const [agenda, setAgenda] = useState("");
  const auth = useAuthSession({ setAgenda, onLoggedOut: vi.fn(), onOnboardingFinished: vi.fn() });
  return { ...auth, agenda, setAgenda, session: useSession() };
}

test("persistent cache cannot establish identity on a fresh mount or revoked reload", () => {
  writeDeskBootCache(payload("previous-owner"));
  expect(peekDeskBootCache()).toBeNull();
  expect(peekDeskBootCache("different-owner")).toBeNull();
  const first = renderHook(useHarness, { wrapper: SessionBoundary });
  expect(first.result.current.authUser).toBeNull();
  expect(first.result.current.authChecked).toBe(false);
  act(() => { first.result.current.applyAuthUser(null); });
  expect(peekDeskBootCache("previous-owner")).toBeNull();
  first.unmount();
  const reload = renderHook(useHarness, { wrapper: SessionBoundary });
  expect(reload.result.current.authUser).toBeNull();
  expect(reload.result.current.authChecked).toBe(false);
});

test.each(["http", "network", "success"])("logout clears immediately and reports %s accurately", async (outcome) => {
  const pending = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn(() => pending.promise));
  const { result } = renderHook(useHarness, { wrapper: SessionBoundary });
  act(() => { result.current.applyAuthUser(owner("a")); result.current.setAgenda("private"); });
  let logout!: Promise<void>;
  act(() => { logout = result.current.onLogout(); });
  expect(result.current.authUser).toBeNull();
  expect(result.current.agenda).toBe("");
  expect(result.current.authNotice).toBe("Signing out…");
  await act(async () => {
    if (outcome === "network") pending.reject(new Error("offline"));
    else pending.resolve(new Response("", { status: outcome === "success" ? 200 : 500 }));
    await logout;
  });
  expect(result.current.authNotice).toBe(outcome === "success" ? "Signed out." : "This tab was cleared, but server sign-out could not be confirmed. Your session may still be active; reload and try signing out again.");
});

test("owner change resets mounted state and rejects old-owner auth and setters", async () => {
  const pending = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn(() => pending.promise));
  const { result } = renderHook(useHarness, { wrapper: SessionBoundary });
  act(() => { result.current.applyAuthUser(owner("a")); result.current.setAgenda("private a"); });
  const old = result.current;
  let hydrate!: Promise<AuthSessionUser | null>;
  act(() => { hydrate = old.hydrateAuth(); });
  act(() => { result.current.applyAuthUser(owner("b")); });
  expect(result.current.agenda).toBe("");
  await act(async () => {
    pending.resolve(Response.json({ ok: true, user: owner("a") }));
    await hydrate;
    old.setAuthUser(owner("a"));
    old.setAgenda("late private a");
    old.invalidateSession();
  });
  expect(result.current.authUser?.id).toBe("b");
  expect(result.current.agenda).toBe("");
});

test("cross-tab invalidation clears memoized cache and state without rebroadcast", () => {
  const { result } = renderHook(useHarness, { wrapper: SessionBoundary });
  act(() => { result.current.applyAuthUser(owner("a")); result.current.setAgenda("private"); });
  writeDeskBootCache(payload("a"));
  expect(peekDeskBootCache("a")?.user?.id).toBe("a");
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  act(() => { window.dispatchEvent(new StorageEvent("storage", { key: SESSION_RESET_KEY, newValue: "another-tab" })); });
  expect(result.current.authUser).toBeNull();
  expect(result.current.agenda).toBe("");
  expect(peekDeskBootCache("a")).toBeNull();
  expect(setItem).not.toHaveBeenCalled();
});

test("late boot after invalidation cannot restore identity, desk, or cache", async () => {
  const pending = deferred<Response>();
  const fetchMock = vi.fn(() => pending.promise);
  vi.stubGlobal("fetch", fetchMock);
  const applyDesk = vi.fn();
  const followup = vi.fn(async () => {});
  let current!: ReturnType<typeof useHarness>;
  function Boot() {
    current = useHarness();
    useDeskBoot({
      dedupeAccounts: false, setAgenda: current.setAgenda, setAuthNotice: current.setAuthNotice,
      setBillingNotice: vi.fn(), setView: vi.fn(), setSignInOpen: vi.fn(),
      applyAuthUser: current.applyAuthUser, hydrateAuth: current.hydrateAuth, applyDesk,
      hydrateDeskWithoutBoot: followup, confirmCheckout: followup, hydrateCoaching: followup,
      hydrateActivityStats: followup, loadBilling: followup, hydrateVoice: followup, loadUsage: followup, loadAdmin: followup,
    });
    return <span>{current.authUser?.id ?? "anonymous"}</span>;
  }
  render(<SessionBoundary><Boot /></SessionBoundary>);
  act(() => { current.invalidateSession(); });
  await act(async () => { pending.resolve(Response.json(payload("late-owner"))); await pending.promise; });
  expect(screen.getByText("anonymous")).toBeTruthy();
  expect(applyDesk).not.toHaveBeenCalled();
  expect(followup).not.toHaveBeenCalled();
  expect(peekDeskBootCache("late-owner")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("generation contract expires synchronously, even if storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  const session = createSession();
  const token = session.capture();
  session.verify(owner("a"), true, token);
  expect(session.isCurrent(token)).toBe(true);
  session.invalidate();
  expect(session.isCurrent(token)).toBe(false);
  expect(session.verify(owner("a"), true, token)).toBeNull();
  expect(session.getSnapshot().user).toBeNull();
});
