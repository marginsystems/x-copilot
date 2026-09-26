import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SessionBoundary } from "../../src/auth/session";
import type { AuthSessionUser } from "../../src/auth/types";
import { useApproachTask } from "../../src/desk/useApproachTask";
import { useDeskHistory } from "../../src/desk/useDeskHistory";
import { readApproachLock } from "../../src/lib/approachLock";
import type { CoachingState, OwnActivity } from "../../src/lib/coaching";
import { emptyDeskBeats } from "../../src/lib/deskPhase";
import { DEFAULT_SETTINGS } from "../../src/lib/settings";

const user: AuthSessionUser = {
  id: "owner", email: null, displayName: null, avatarUrl: null,
  onboardingCompleted: true, agenda: null, xUsername: "owner",
  xLinked: true, xCanPost: true, isAdmin: false,
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
  emit(type: string, data: unknown, lastEventId = "") {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data), lastEventId }));
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

function setup(nowMs: number) {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  const fetch = vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetch);
  const onscreen: OwnActivity = {
    id: "post-onscreen",
    kind: "original",
    postedAt: new Date(nowMs - 60_000).toISOString(),
    url: "https://x.com/owner/status/post-onscreen",
    text: "already on screen",
  };
  const coaching: CoachingState = {
    dayUtc: new Date(nowMs).toISOString().slice(0, 10),
    nextAction: null,
    missions: [],
    beats: emptyDeskBeats(),
    ownActivity: onscreen,
  };
  const onRefreshCoaching = vi.fn();
  const hook = renderHook(() => {
    const history = useDeskHistory({
      setStatus: vi.fn(), setThreads: vi.fn(), setActionBusy: vi.fn(), settings: DEFAULT_SETTINGS,
    }, user.id);
    return useApproachTask({
      authUser: user, deskBootReady: true, agendaReady: true,
      agenda: "Help developers build reliable software and share useful engineering ideas.",
      curatedThreads: [], forYouSuggestions: [], coaching,
      interactedIds: history.interactedIds, interactedRetainedHistory: history.interactedRetainedHistory,
      dismissedHistory: [], dismissThread: null, searching: false,
      setExpandedId: vi.fn(), actForYou: vi.fn(), onSkip: vi.fn(), onDismiss: vi.fn(),
      onRefreshCoaching, onHydrateInteracted: vi.fn(), onPollInteracted: vi.fn(),
    });
  }, { wrapper });
  return { ...hook, fetch, onRefreshCoaching, onscreen };
}

test("an own_post wake marks the For You card detected without a coaching request", () => {
  const nowMs = Date.now();
  const { result, fetch, onRefreshCoaching, onscreen } = setup(nowMs);
  expect(result.current.presentation.detector).toBe("for_you");
  expect(result.current.cardInput.forYou?.detected).toBe(false);
  const lock = readApproachLock(user.id);

  act(() => {
    liveStream().emit("own_post", onscreen, "boot.1");
    liveStream().emit("own_post", {
      id: "post-late", kind: "reply", postedAt: new Date(nowMs - 30_000).toISOString(),
      url: "https://x.com/owner/status/post-late", text: "older late post",
    }, "boot.2");
  });
  expect(result.current.cardInput.forYou?.detected).toBe(false);

  const fresh = {
    id: "post-fresh", kind: "original", postedAt: new Date(nowMs + 5_000).toISOString(),
    url: "https://x.com/owner/status/post-fresh", text: "posted from For You",
  };
  act(() => { liveStream().emit("own_post", fresh, "boot.3"); });
  expect(result.current.cardInput.forYou).toEqual({ detected: true, activity: fresh });
  expect(onRefreshCoaching).not.toHaveBeenCalled();
  expect(fetch.mock.calls.map(([url]) => String(url)).filter((url) => /coaching|interacted/.test(url))).toEqual([]);
  expect(readApproachLock(user.id)).toEqual(lock);
});
