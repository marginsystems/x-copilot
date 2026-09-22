import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SessionBoundary, useSession } from "../../src/auth/session";
import type { AuthSessionUser } from "../../src/auth/types";
import { useApproachTask } from "../../src/desk/useApproachTask";
import { useDeskHistory } from "../../src/desk/useDeskHistory";
import { readRetainedSuggestion } from "../../src/desk/approachRetained";
import { readApproachLock, writeApproachLock } from "../../src/lib/approachLock";
import type { ForYouSuggestion } from "../../src/lib/forYou";
import { DEFAULT_SETTINGS } from "../../src/lib/settings";
import { deferred } from "./support/deferred";

const user: AuthSessionUser = {
  id: "owner", email: null, displayName: null, avatarUrl: null,
  onboardingCompleted: true, agenda: null, xUsername: "owner",
  xLinked: true, xCanPost: true, isAdmin: false,
};
const suggestion: ForYouSuggestion = {
  id: "suggestion", kind: "reply", why: "Relevant conversation", draft: null,
  targetId: "123", targetUrl: null, targetAuthor: "author",
};
const lock = { phase: "organic_reply", cardId: suggestion.id, surface: null } as const;
function wrapper({ children }: { children: ReactNode }) {
  return <StrictMode><SessionBoundary>{children}</SessionBoundary></StrictMode>;
}

function setup() {
  const requests: ReturnType<typeof deferred<Response>>[] = [];
  const done = vi.fn(() => {
    const request = deferred<Response>();
    requests.push(request);
    return request.promise;
  });
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith("/api/for-you/done")) {
      expect(JSON.parse(String(init?.body))).toEqual({ id: suggestion.id });
      return done();
    }
    return Promise.resolve(new Response("{}"));
  }));
  // Advancing to For You installs its existing detector.
  vi.stubGlobal("EventSource", class { addEventListener() {} close() {} });
  const setStatus = vi.fn();
  const onRefreshCoaching = vi.fn();
  const mount = () => renderHook(({ ready }) => {
    const session = useSession();
    const history = useDeskHistory({
      setStatus, setThreads: vi.fn(), setActionBusy: vi.fn(), settings: DEFAULT_SETTINGS,
    }, null);
    const approach = useApproachTask({
      authUser: user, deskBootReady: ready, agendaReady: true,
      agenda: "Help developers build reliable software and share useful engineering ideas.",
      curatedThreads: [], forYouSuggestions: history.forYouSuggestions,
      interactedIds: new Set(["123"]), interactedHistory: [],
      dismissedHistory: [], dismissThread: null, searching: false,
      setExpandedId: vi.fn(), actForYou: history.actForYou,
      onSkip: vi.fn(), onDismiss: vi.fn(), onRefreshCoaching, onHydrateInteracted: vi.fn(),
    });
    return { approach, history, session };
  }, { wrapper, initialProps: { ready: false } });
  const boot = (hook: ReturnType<typeof mount>, suggestions = [suggestion]) => {
    act(() => {
      hook.result.current.session.verify(user, true, hook.result.current.session.capture());
      hook.result.current.history.applyHistoryFromBoot({
        forYou: { suggestions, progress: null, extra: null },
      });
    });
    hook.rerender({ ready: true });
  };
  writeApproachLock(user.id, lock);
  const hook = mount();
  boot(hook);
  return { ...hook, mount, boot, requests, done, setStatus, onRefreshCoaching };
}

test.each([500, "network"] as const)(
  "%s keeps the detected card locked across refresh and allows retry of the same id",
  async (failure) => {
    const { result, unmount, mount, boot, requests, done, setStatus, onRefreshCoaching } = setup();
    expect(result.current.approach.cardInput.suggestionDetected).toBe(true);
    expect(readApproachLock(user.id)).toEqual(lock);
    act(() => {
      result.current.approach.onSuggestionPosted(suggestion.id);
      result.current.approach.onSuggestionPosted(suggestion.id);
    });
    expect(done).toHaveBeenCalledTimes(1);
    expect(result.current.approach.cardInput.suggestion?.id).toBe(suggestion.id);
    expect(readApproachLock(user.id)).toEqual(lock);
    await act(async () => {
      if (failure === "network") requests[0].reject(new Error("offline"));
      else requests[0].resolve(new Response(null, { status: failure }));
    });
    expect(result.current.approach.cardInput.suggestionDetected).toBe(true);
    expect(readApproachLock(user.id)).toEqual(lock);
    expect(readRetainedSuggestion(user.id)).toEqual(suggestion);
    expect(setStatus).toHaveBeenCalledWith("Could not update For You. Try again.");
    unmount();
    const refreshed = mount();
    boot(refreshed, [suggestion]);
    expect(refreshed.result.current.approach.cardInput.suggestion?.id).toBe(suggestion.id);
    expect(refreshed.result.current.approach.cardInput.suggestionDetected).toBe(true);
    const oldClick = refreshed.result.current.approach.onSuggestionPosted;
    act(() => { oldClick(suggestion.id); oldClick(suggestion.id); });
    expect(done).toHaveBeenCalledTimes(2);
    await act(async () => { requests[1].resolve(new Response("{}")); });
    expect(onRefreshCoaching).toHaveBeenCalledTimes(1);
    expect(readApproachLock(user.id)?.cardId).not.toBe(suggestion.id);
    expect(readRetainedSuggestion(user.id)).toBeNull();
    act(() => { oldClick(suggestion.id); });
    expect(done).toHaveBeenCalledTimes(2);
  },
);

test("failure releases the pending guard for an immediate retry", async () => {
  const { result, requests, done } = setup();
  act(() => { result.current.approach.onSuggestionPosted(suggestion.id); });
  await act(async () => { requests[0].resolve(new Response(null, { status: 500 })); });
  act(() => { result.current.approach.onSuggestionPosted(suggestion.id); });
  expect(done).toHaveBeenCalledTimes(2);
  await act(async () => { requests[1].resolve(new Response("{}")); });
  expect(readApproachLock(user.id)?.cardId).not.toBe(suggestion.id);
});

test("terminal done 404 reconciles the detected card", async () => {
  const { result, requests, done, onRefreshCoaching } = setup();
  act(() => { result.current.approach.onSuggestionPosted(suggestion.id); });
  await act(async () => { requests[0].resolve(new Response(null, { status: 404 })); });
  expect(done).toHaveBeenCalledTimes(1);
  expect(result.current.history.forYouSuggestions).toEqual([]);
  expect(onRefreshCoaching).toHaveBeenCalledTimes(1);
  expect(readApproachLock(user.id)?.cardId).not.toBe(suggestion.id);
  expect(readRetainedSuggestion(user.id)).toBeNull();
});

test.each(["logout", "owner replacement", "unmount"] as const)(
  "late acknowledgement after %s cannot write an advanced lock",
  async (end) => {
    const { result, requests, unmount, done } = setup();
    const old = result.current;
    act(() => { old.approach.onSuggestionPosted(suggestion.id); });
    act(() => {
      if (end === "logout") old.session.invalidate("", false);
      else if (end === "owner replacement") {
        old.session.verify({ ...user, id: "replacement" }, true, old.session.capture());
      } else unmount();
    });
    const storage = vi.spyOn(Storage.prototype, "setItem");
    await act(async () => { requests[0].resolve(new Response("{}")); });
    expect(storage.mock.calls.filter(([key]) => key.startsWith("x-copilot-approach-lock"))).toEqual([]);
    expect(readApproachLock(user.id)).toEqual(lock);
    act(() => { old.approach.onSuggestionPosted(suggestion.id); });
    expect(done).toHaveBeenCalledTimes(1);
  },
);
