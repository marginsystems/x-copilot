import { useState } from "react";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { createSession, SessionBoundary, SESSION_RESET_KEY, useSession } from "../../src/auth/session";
import { useAuthSession } from "../../src/auth/useAuthSession";
import { useDeskBoot } from "../../src/desk/useDeskBoot";
import { peekDeskBootCache, writeDeskBootCache, type DeskBootPayload } from "../../src/lib/deskBoot";
import type { AuthSessionUser } from "../../src/auth/types";
import { deferred } from "./support/deferred";
import { OTHER_OWNER_HINT, OWNER_HINT, clearOwnerCookie, setOwnerCookie } from "./support/ownerHint";

const owner = (id: string): AuthSessionUser => ({ id, email: null, displayName: id, avatarUrl: null, onboardingCompleted: true, agenda: null, xUsername: null, xLinked: true, isAdmin: false });
const payload = (id: string): DeskBootPayload => ({ ok: true, user: owner(id), authRequired: true, ownerHint: OWNER_HINT, desk: null });
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

test("indeterminate auth failure does not invalidate the current session", async () => {
  const pending = deferred<Response>();
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  vi.stubGlobal("fetch", vi.fn(() => pending.promise));
  const { result } = renderHook(useHarness, { wrapper: SessionBoundary });
  act(() => { result.current.applyAuthUser(owner("a")); });
  const generation = result.current.session.capture();
  let hydrate!: Promise<AuthSessionUser | null>;
  act(() => { hydrate = result.current.hydrateAuth(); });
  await act(async () => {
    pending.reject(new Error("offline"));
    await hydrate;
  });
  expect(result.current.authUser?.id).toBe("a");
  expect(result.current.authChecked).toBe(true);
  expect(result.current.session.isCurrent(generation)).toBe(true);
  expect(setItem).not.toHaveBeenCalledWith(SESSION_RESET_KEY, expect.anything());
});

test("clearing a missing auth user does not invalidate the session", () => {
  const { result } = renderHook(useHarness, { wrapper: SessionBoundary });
  const generation = result.current.session.capture();
  act(() => { result.current.finishOnboarding("local agenda"); });
  expect(result.current.authUser).toBeNull();
  expect(result.current.agenda).toBe("local agenda");
  expect(result.current.session.isCurrent(generation)).toBe(true);
  act(() => { result.current.applyAuthUser(owner("local-owner")); });
  expect(result.current.authUser?.id).toBe("local-owner");
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
      applyAuthUser: current.applyAuthUser, applyDesk,
      confirmCheckout: followup, hydrateCoaching: followup,
      hydrateActivityStats: followup, loadBilling: followup, loadUsage: followup, loadAdmin: followup,
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

test("verify keeps a hint that matches the cookie and drops one that does not", () => {
  setOwnerCookie(OWNER_HINT);
  const matching = renderHook(useHarness, { wrapper: SessionBoundary });
  act(() => { matching.result.current.applyAuthUser(owner("a"), true, OWNER_HINT); });
  expect(matching.result.current.session.getSnapshot().ownerHint).toBe(OWNER_HINT);
  const mismatching = renderHook(useHarness, { wrapper: SessionBoundary });
  act(() => { mismatching.result.current.applyAuthUser(owner("a"), true, OTHER_OWNER_HINT); });
  expect(mismatching.result.current.session.getSnapshot().ownerHint).toBeNull();
});

test("an omitted hint keeps the verified hint across hydrateAuth failure and hint-less /me", async () => {
  setOwnerCookie(OWNER_HINT);
  const { result } = renderHook(useHarness, { wrapper: SessionBoundary });
  act(() => { result.current.applyAuthUser(owner("a"), true, OWNER_HINT); });
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  await act(async () => { await result.current.hydrateAuth(); });
  expect(result.current.session.getSnapshot().ownerHint).toBe(OWNER_HINT);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, user: owner("a"), authRequired: true })));
  await act(async () => { await result.current.hydrateAuth(); });
  expect(result.current.session.getSnapshot().ownerHint).toBe(OWNER_HINT);
});

test.each(["boot", "legacy /api/auth/me"])("the verified hint is stored after %s", async (path) => {
  setOwnerCookie(OWNER_HINT);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/boot?")) {
      return path === "boot" ? Response.json(payload("a")) : new Response(null, { status: 404 });
    }
    if (url.endsWith("/api/auth/me")) return Response.json({ ok: true, user: owner("a"), authRequired: true, ownerHint: OWNER_HINT });
    return Response.json({ ok: true });
  }));
  const followup = vi.fn(async () => {});
  let current!: ReturnType<typeof useHarness>;
  function Boot() {
    current = useHarness();
    useDeskBoot({
      dedupeAccounts: false, setAgenda: current.setAgenda, setAuthNotice: current.setAuthNotice,
      setBillingNotice: vi.fn(), setView: vi.fn(), setSignInOpen: vi.fn(),
      applyAuthUser: current.applyAuthUser, applyDesk: vi.fn(),
      confirmCheckout: followup, hydrateCoaching: followup,
      hydrateActivityStats: followup, loadBilling: followup, loadUsage: followup, loadAdmin: followup,
    });
    return <span>{current.authUser?.id ?? "anonymous"}</span>;
  }
  render(<SessionBoundary><Boot /></SessionBoundary>);
  await waitFor(() => expect(screen.getByText("a")).toBeTruthy());
  expect(current.session.getSnapshot().ownerHint).toBe(OWNER_HINT);
});

test("clearOwnerCookie removes the cookie entirely", () => {
  setOwnerCookie(OWNER_HINT);
  expect(document.cookie).toContain("xc_owner=");
  clearOwnerCookie();
  expect(document.cookie).not.toContain("xc_owner");
});
