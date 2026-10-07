import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SessionBoundary } from "../../src/auth/session";
import type { AuthSessionUser } from "../../src/auth/types";
import { useApproachTask } from "../../src/desk/useApproachTask";
import { useDeskHistory } from "../../src/desk/useDeskHistory";
import { readApproachLock, writeApproachLock } from "../../src/lib/approachLockStore";
import type { ThreadCard } from "../../../shared/src/deskTypes";
import type { ForYouSuggestion } from "../../../shared/src/forYou";
import { DEFAULT_SETTINGS } from "../../src/lib/settings";
import { isRecord } from "../../../shared/src/typeGuards";

const user: AuthSessionUser = {
  id: "owner", email: null, displayName: null, avatarUrl: null,
  onboardingCompleted: true, agenda: null, xUsername: "owner",
  xLinked: true, isAdmin: false,
};

const scout: ThreadCard = { id: "1001", author: "@alice", text: "first", url: "https://x.com/alice/status/1001" };
const og: ForYouSuggestion = {
  id: "sug-og", kind: "post", why: "Take a side on whether AI wealth gains reach displaced workers",
  targetId: null, targetUrl: null, targetAuthor: null,
};

class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.OPEN;
  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(type: string, data: unknown) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

function liveStream(): FakeEventSource {
  const open = FakeEventSource.instances.filter((source) => source.readyState !== FakeEventSource.CLOSED);
  expect(open).toHaveLength(1);
  return open[0]!;
}

function wrapper({ children }: { children: ReactNode }) {
  return <StrictMode><SessionBoundary>{children}</SessionBoundary></StrictMode>;
}

function ownPost(id: string, kind: string, postedAt: number, extra: Record<string, unknown> = {}) {
  return { id, kind, postedAt: new Date(postedAt).toISOString(), url: `https://x.com/owner/status/${id}`, text: "", ...extra };
}

type FetchMock = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;

function publishedStates(fetchMock: FetchMock): unknown[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => String(url).endsWith("/api/scout-approach-lock") && init?.method === "PUT")
    .map(([, init]) => {
      const body: unknown = JSON.parse(String(init?.body));
      return isRecord(body) ? body.state : undefined;
    });
}

function setup(serverState: unknown = null) {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  const fetchMock: FetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/api/scout-approach-lock") && !init?.method) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, card: null, state: serverState })));
    }
    return Promise.resolve(new Response("{}"));
  });
  vi.stubGlobal("fetch", fetchMock);
  const actForYou = vi.fn(() => Promise.resolve(true));
  const onRefreshCoaching = vi.fn();
  writeApproachLock(user.id, { phase: "organic_reply", cardId: og.id, surface: null });
  const hook = renderHook(() => {
    const history = useDeskHistory({
      setStatus: vi.fn(), setThreads: vi.fn(), setActionBusy: vi.fn(), settings: DEFAULT_SETTINGS,
    }, user.id);
    return useApproachTask({
      authUser: user, writesEnabled: true, deskBootReady: true, agendaReady: true,
      agenda: "Help developers build reliable software and share useful engineering ideas.",
      curatedThreads: [scout], forYouSuggestions: [og],
      interactedIds: new Set(), interactedRetainedHistory: history.interactedRetainedHistory,
      dismissedHistory: [], dismissThread: null, searching: false,
      actForYou, onSkip: vi.fn(), onDismiss: vi.fn(),
      onRefreshCoaching, onHydrateInteracted: vi.fn(), onPollInteracted: vi.fn(),
    });
  }, { wrapper });
  return { ...hook, fetchMock, actForYou, onRefreshCoaching };
}

test("an original post card waits for the user's next original post and ignores replies, quotes, earlier and unconfirmed posts", async () => {
  const nowMs = Date.now();
  const { result, fetchMock } = setup();
  expect(result.current.presentation.detector).toBe("for_you");
  expect(result.current.cardInput.suggestionDetected).toBe(false);

  act(() => {
    liveStream().emit("own_post", ownPost("1900000001", "reply", nowMs + 5_000));
    liveStream().emit("own_post", ownPost("1900000002", "quote", nowMs + 5_000));
    liveStream().emit("own_post", ownPost("1900000003", "original", nowMs - 60_000));
    liveStream().emit("own_post", ownPost("1900000004", "original", nowMs + 5_000, { provisional: true }));
  });
  expect(result.current.cardInput.suggestionDetected).toBe(false);
  expect(result.current.presentation.detector).toBe("for_you");

  act(() => { liveStream().emit("own_post", ownPost("1900000005", "original", nowMs + 6_000)); });
  expect(result.current.cardInput.suggestionDetected).toBe(true);
  expect(result.current.cardInput.suggestionPost).toEqual({ id: "1900000005", url: "https://x.com/owner/status/1900000005" });
  expect(result.current.presentation.detector).toBeNull();
  expect(readApproachLock(user.id)?.cardId).toBe(og.id);
  await waitFor(() => {
    expect(publishedStates(fetchMock).at(-1)).toMatchObject({
      view: "suggestion",
      detected: true,
      suggestion: { id: og.id, kind: "post" },
      post: { id: "1900000005" },
    });
  });
});

test("Next on a detected original post card records it done with the post id, then moves on as I posted on X did", async () => {
  const nowMs = Date.now();
  const { result, actForYou, onRefreshCoaching } = setup();
  act(() => { liveStream().emit("own_post", ownPost("1900000006", "original", nowMs + 5_000)); });
  expect(result.current.cardInput.suggestionDetected).toBe(true);

  act(() => { result.current.onSuggestionPosted(og.id); });
  await waitFor(() => expect(readApproachLock(user.id)?.cardId).not.toBe(og.id));
  expect(actForYou).toHaveBeenCalledWith(og.id, "done", "1900000006");
  expect(onRefreshCoaching).toHaveBeenCalled();
});

test("Next before any post is detected moves off the original post card without recording it", () => {
  const { result, actForYou } = setup();
  act(() => { result.current.onSuggestionNext(og.id); });
  expect(readApproachLock(user.id)).toEqual({ phase: "scout_reply", cardId: scout.id, surface: null });
  expect(actForYou).not.toHaveBeenCalled();
});

test("the desk shows the server's detection of the original post it is on, from the stored state", async () => {
  const state = {
    view: "suggestion",
    detected: true,
    suggestion: { ...og, openUrl: "https://x.com/home" },
    post: { id: "1900000007", url: "https://x.com/owner/status/1900000007" },
  };
  const { result } = setup(state);
  await waitFor(() => expect(result.current.cardInput.suggestionDetected).toBe(true));
  expect(result.current.cardInput.suggestionPost).toEqual(state.post);
});
