import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { AuthSessionUser } from "../../src/auth/types";
import { useAuthSession } from "../../src/auth/useAuthSession";
import { SessionBoundary } from "../../src/auth/session";
import { useAgendaPersist } from "../../src/desk/useAgendaPersist";
import { deferred } from "./support/deferred";

const owner = (id: string): AuthSessionUser => ({
  id,
  email: null,
  displayName: id,
  avatarUrl: null,
  onboardingCompleted: true,
  agenda: null,
  xUsername: null,
  xLinked: true,
  xCanPost: true,
  isAdmin: false,
});
const draft = (label: string) => `${label} `.repeat(25);

function useHarness() {
  const [agenda, setAgenda] = useState("");
  const [enabled, setEnabled] = useState(true);
  const auth = useAuthSession({
    setAgenda,
    onLoggedOut: vi.fn(),
    onOnboardingFinished: vi.fn(),
  });
  const persist = useAgendaPersist({
    agenda,
    enabled: enabled && Boolean(auth.authUser),
    authUser: auth.authUser,
    setAuthUser: auth.setAuthUser,
  });
  return { ...auth, ...persist, agenda, setAgenda, setEnabled };
}

test("queued save cannot cross an owner replacement", async () => {
  const first = deferred<Response>();
  const fetchMock = vi.fn<typeof fetch>().mockReturnValue(first.promise);
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(useHarness, { wrapper: SessionBoundary });

  act(() => {
    result.current.applyAuthUser(owner("a"));
    result.current.setAgenda(draft("owner a first"));
  });
  act(() => result.current.flushAgenda());
  expect(fetchMock).toHaveBeenCalledTimes(1);

  act(() => result.current.setAgenda(draft("owner a queued")));
  act(() => {
    result.current.flushAgenda();
    result.current.applyAuthUser(owner("b"));
  });
  expect(result.current.authUser?.id).toBe("b");

  await act(async () => {
    first.resolve(Response.json({ ok: true }));
    await first.promise;
    await Promise.resolve();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(result.current.authUser).toEqual(owner("b"));
});

test("queued save stops when persistence is disabled", async () => {
  const first = deferred<Response>();
  const fetchMock = vi.fn<typeof fetch>().mockReturnValue(first.promise);
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(useHarness, { wrapper: SessionBoundary });

  act(() => {
    result.current.applyAuthUser(owner("a"));
    result.current.setAgenda(draft("first"));
  });
  act(() => result.current.flushAgenda());
  act(() => result.current.setAgenda(draft("queued")));
  act(() => {
    result.current.flushAgenda();
    result.current.setEnabled(false);
  });

  await act(async () => {
    first.resolve(Response.json({ ok: true }));
    await first.promise;
    await Promise.resolve();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(result.current.authUser?.agenda).toBeNull();
});

test("logout cleanup does not send an agenda", () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(useHarness, { wrapper: SessionBoundary });

  act(() => {
    result.current.applyAuthUser(owner("a"));
    result.current.setAgenda(draft("private"));
  });
  act(() => result.current.invalidateSession());
  expect(fetchMock).not.toHaveBeenCalled();
});

test("same-owner saves stay ordered and retry after failure", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(useHarness, { wrapper: SessionBoundary });
  const agenda = draft("retry");

  act(() => {
    result.current.applyAuthUser(owner("a"));
    result.current.setAgenda(agenda);
  });
  act(() => {
    result.current.flushAgenda();
    result.current.flushAgenda();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await act(async () => {
    first.resolve(new Response("", { status: 500 }));
    await first.promise;
    await Promise.resolve();
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);

  await act(async () => {
    second.resolve(Response.json({ ok: true }));
    await second.promise;
    await Promise.resolve();
  });
  expect(result.current.authUser?.agenda).toBe(agenda.trim());
});
