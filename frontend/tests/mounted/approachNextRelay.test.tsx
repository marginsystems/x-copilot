import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SessionBoundary } from "../../src/auth/session";
import type { AuthSessionUser } from "../../src/auth/types";
import { useApproachTask } from "../../src/desk/useApproachTask";
import { useDeskHistory } from "../../src/desk/useDeskHistory";
import { readApproachLock, writeApproachLock } from "../../src/lib/approachLockStore";
import type { ThreadCard } from "../../../shared/src/deskTypes";
import { DEFAULT_SETTINGS } from "../../src/lib/settings";

const user: AuthSessionUser = {
  id: "owner", email: null, displayName: null, avatarUrl: null,
  onboardingCompleted: true, agenda: null, xUsername: "owner",
  xLinked: true, isAdmin: false,
};

const cardA: ThreadCard = { id: "1001", author: "@alice", text: "first", url: "https://x.com/alice/status/1001" };
const cardB: ThreadCard = { id: "1002", author: "@bob", text: "second", url: "https://x.com/bob/status/1002" };

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

function setup(interactedIds: Set<string>) {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}"))));
  writeApproachLock(user.id, { phase: "scout_reply", cardId: cardA.id, surface: null });
  return renderHook(() => {
    const history = useDeskHistory({
      setStatus: vi.fn(), setThreads: vi.fn(), setActionBusy: vi.fn(), settings: DEFAULT_SETTINGS,
    }, user.id);
    return useApproachTask({
      authUser: user, writesEnabled: true, deskBootReady: true, agendaReady: true,
      agenda: "Help developers build reliable software and share useful engineering ideas.",
      curatedThreads: [cardA, cardB], forYouSuggestions: [],
      interactedIds, interactedRetainedHistory: history.interactedRetainedHistory,
      dismissedHistory: [], dismissThread: null, searching: false,
      actForYou: vi.fn(), onSkip: vi.fn(), onDismiss: vi.fn(),
      onRefreshCoaching: vi.fn(), onHydrateInteracted: vi.fn(), onPollInteracted: vi.fn(),
    });
  }, { wrapper });
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test("the extension's Next moves the desk off a replied Scout card", () => {
  setup(new Set([cardA.id]));
  expect(readApproachLock(user.id)?.cardId).toBe(cardA.id);

  act(() => { liveStream().emit("approach_next", { fromCardId: "someone-else" }); });
  expect(readApproachLock(user.id)?.cardId).toBe(cardA.id);

  act(() => { liveStream().emit("approach_next", { fromCardId: cardA.id }); });
  expect(readApproachLock(user.id)?.cardId).not.toBe(cardA.id);
});

test("the extension's Next leaves an unreplied Scout card in place", () => {
  setup(new Set());
  act(() => { liveStream().emit("approach_next", { fromCardId: cardA.id }); });
  expect(readApproachLock(user.id)?.cardId).toBe(cardA.id);
});
