import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SessionBoundary } from "../../src/auth/session";
import type { AuthSessionUser } from "../../src/auth/types";
import { useApproachTask } from "../../src/desk/useApproachTask";
import { useDeskHistory } from "../../src/desk/useDeskHistory";
import {
  APPROACH_NEXT_PENDING_MS,
  clearPendingApproachNext,
  peekPendingApproachNext,
} from "../../src/desk/deskEventStream";
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

function stubBrowser() {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mountStreamOnly(ownerId = user.id) {
  return renderHook(() => useDeskHistory({
    setStatus: vi.fn(), setThreads: vi.fn(), setActionBusy: vi.fn(), settings: DEFAULT_SETTINGS,
  }, ownerId), { wrapper });
}

function setup(interactedIds: Set<string>, opts: { keepBrowser?: boolean; lockId?: string } = {}) {
  if (!opts.keepBrowser) stubBrowser();
  const lockedCard = opts.lockId ? { ...cardA, id: opts.lockId } : cardA;
  writeApproachLock(user.id, { phase: "scout_reply", cardId: lockedCard.id, surface: null });
  return renderHook(() => {
    const history = useDeskHistory({
      setStatus: vi.fn(), setThreads: vi.fn(), setActionBusy: vi.fn(), settings: DEFAULT_SETTINGS,
    }, user.id);
    return useApproachTask({
      authUser: user, writesEnabled: true, deskBootReady: true, agendaReady: true,
      agenda: "Help developers build reliable software and share useful engineering ideas.",
      curatedThreads: [lockedCard, cardB], forYouSuggestions: [],
      interactedIds, interactedRetainedHistory: history.interactedRetainedHistory,
      dismissedHistory: [], dismissThread: null, searching: false,
      actForYou: vi.fn(), onSkip: vi.fn(), onDismiss: vi.fn(),
      onRefreshCoaching: vi.fn(), onHydrateInteracted: vi.fn(), onPollInteracted: vi.fn(),
    });
  }, { wrapper });
}

afterEach(() => {
  clearPendingApproachNext();
  vi.restoreAllMocks();
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

test("the desk takes the card the server moved to when its event stream reconnects", async () => {
  const fetchMock = stubBrowser();
  setup(new Set(), { keepBrowser: true });
  expect(readApproachLock(user.id)?.cardId).toBe(cardA.id);

  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const isLockRead = String(input).includes("/api/scout-approach-lock") && (init?.method ?? "GET") === "GET";
    const body = isLockRead
      ? { ok: true, card: null, task: { lock: { phase: "scout_reply", cardId: cardB.id, surface: null }, version: 4, owner: "server" } }
      : {};
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
  act(() => { liveStream().emit("ready", {}); });

  await waitFor(() => expect(readApproachLock(user.id)?.cardId).toBe(cardB.id));
});

test("the extension's Next leaves an unreplied Scout card in place", () => {
  setup(new Set());
  act(() => { liveStream().emit("approach_next", { fromCardId: cardA.id }); });
  expect(readApproachLock(user.id)?.cardId).toBe(cardA.id);
});

test("publishes Collecting when an empty Scout lock has no locked card", async () => {
  const fetchMock = stubBrowser();
  writeApproachLock(user.id, { phase: "scout_reply", cardId: null, surface: null });
  const task = renderHook(() => useApproachTask({
    authUser: user,
    writesEnabled: true,
    deskBootReady: true,
    agendaReady: true,
    agenda: "Help developers build reliable software and share useful engineering ideas.",
    curatedThreads: [],
    forYouSuggestions: [],
    interactedIds: new Set(),
    interactedRetainedHistory: [],
    dismissedHistory: [],
    dismissThread: null,
    searching: false,
    actForYou: vi.fn(),
    onSkip: vi.fn(),
    onDismiss: vi.fn(),
    onRefreshCoaching: vi.fn(),
    onHydrateInteracted: vi.fn(),
    onPollInteracted: vi.fn(),
  }), { wrapper });

  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).includes("/api/scout-approach-lock") && init?.method === "PUT",
    )).toBe(true);
  });
  const put = fetchMock.mock.calls.find(([url, init]) =>
    String(url).includes("/api/scout-approach-lock") && init?.method === "PUT",
  );
  expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({
    card: null,
    state: { view: "collecting", detected: false },
  });

  task.unmount();
});

test("a Scout card id equal to the old For You sentinel still applies as a Scout request", () => {
  setup(new Set(["for_you"]), { lockId: "for_you" });
  expect(readApproachLock(user.id)?.cardId).toBe("for_you");

  act(() => { liveStream().emit("approach_next", { fromCardId: "for_you" }); });
  expect(readApproachLock(user.id)?.cardId).not.toBe("for_you");
});

test("a Next that arrives while the desk is off the dashboard applies when the dashboard opens", () => {
  stubBrowser();
  const account = mountStreamOnly();
  act(() => { liveStream().emit("approach_next", { fromCardId: cardA.id }); });
  account.unmount();

  setup(new Set([cardA.id]), { keepBrowser: true });
  expect(readApproachLock(user.id)?.cardId).not.toBe(cardA.id);
});

test("an expired Next leaves the Scout card in place when the dashboard opens", () => {
  stubBrowser();
  const nowMs = Date.now();
  const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);
  const account = mountStreamOnly();
  act(() => { liveStream().emit("approach_next", { fromCardId: cardA.id }); });
  expect(peekPendingApproachNext(nowMs + APPROACH_NEXT_PENDING_MS)).toBeNull();
  act(() => { liveStream().emit("approach_next", { fromCardId: cardA.id }); });
  account.unmount();

  dateNow.mockReturnValue(nowMs + APPROACH_NEXT_PENDING_MS);
  setup(new Set([cardA.id]), { keepBrowser: true });
  expect(readApproachLock(user.id)?.cardId).toBe(cardA.id);
});

test("a kept Next for a card the desk has since left is dropped", () => {
  stubBrowser();
  const account = mountStreamOnly();
  act(() => { liveStream().emit("approach_next", { fromCardId: "some-old-card" }); });
  account.unmount();

  setup(new Set([cardA.id]), { keepBrowser: true });
  expect(readApproachLock(user.id)?.cardId).toBe(cardA.id);
  expect(peekPendingApproachNext()).toBeNull();
  act(() => { liveStream().emit("approach_next", { fromCardId: cardA.id }); });
  expect(readApproachLock(user.id)?.cardId).not.toBe(cardA.id);
});

test("a kept Next is cleared when the event stream changes owners", () => {
  stubBrowser();
  const account = mountStreamOnly("owner-a");
  act(() => { liveStream().emit("approach_next", { fromCardId: cardA.id }); });
  account.unmount();
  expect(peekPendingApproachNext()).not.toBeNull();

  const nextAccount = mountStreamOnly("owner-b");
  expect(peekPendingApproachNext()).toBeNull();
  nextAccount.unmount();
});
