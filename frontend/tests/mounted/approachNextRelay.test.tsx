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
import type { ForYouSuggestion } from "../../../shared/src/forYou";
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

function publishedLockCardId(body: unknown): unknown {
  if (typeof body !== "object" || body === null || !("lock" in body)) return undefined;
  const { lock } = body;
  return typeof lock === "object" && lock !== null && "cardId" in lock ? lock.cardId : undefined;
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

type ActionMocks = {
  onSkip?: ReturnType<typeof vi.fn>;
  onDismiss?: ReturnType<typeof vi.fn>;
  actForYou?: ReturnType<typeof vi.fn>;
};

function setup(interactedIds: Set<string>, opts: { keepBrowser?: boolean; lockId?: string } & ActionMocks = {}) {
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
      actForYou: opts.actForYou ?? vi.fn(), onSkip: opts.onSkip ?? vi.fn(), onDismiss: opts.onDismiss ?? vi.fn(),
      onRefreshCoaching: vi.fn(), onHydrateInteracted: vi.fn(), onPollInteracted: vi.fn(),
    });
  }, { wrapper });
}

const postSuggestion: ForYouSuggestion = {
  id: "sug-post", kind: "post", why: "Take a side on whether AI wealth gains reach displaced workers",
  targetId: null, targetUrl: null, targetAuthor: null,
};
const replySuggestion: ForYouSuggestion = {
  id: "sug-reply", kind: "reply", why: "Join this thread",
  targetId: "900", targetUrl: "https://x.com/erin/status/900", targetAuthor: "@erin",
};
const otherReplySuggestion: ForYouSuggestion = {
  id: "sug-reply-2", kind: "reply", why: "Answer this one",
  targetId: "901", targetUrl: "https://x.com/finn/status/901", targetAuthor: "@finn",
};

function setupSuggested(
  locked: ForYouSuggestion,
  opts: {
    suggestions?: ForYouSuggestion[];
    threads?: ThreadCard[];
    actForYou?: ReturnType<typeof vi.fn>;
    onRefreshCoaching?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const fetchMock = stubBrowser();
  writeApproachLock(user.id, { phase: "organic_reply", cardId: locked.id, surface: null });
  const hook = renderHook(() => {
    const history = useDeskHistory({
      setStatus: vi.fn(), setThreads: vi.fn(), setActionBusy: vi.fn(), settings: DEFAULT_SETTINGS,
    }, user.id);
    return useApproachTask({
      authUser: user, writesEnabled: true, deskBootReady: true, agendaReady: true,
      agenda: "Help developers build reliable software and share useful engineering ideas.",
      curatedThreads: opts.threads ?? [cardA, cardB], forYouSuggestions: opts.suggestions ?? [locked],
      interactedIds: new Set(), interactedRetainedHistory: history.interactedRetainedHistory,
      dismissedHistory: [], dismissThread: null, searching: false,
      actForYou: opts.actForYou ?? vi.fn(), onSkip: vi.fn(), onDismiss: vi.fn(),
      onRefreshCoaching: opts.onRefreshCoaching ?? vi.fn(), onHydrateInteracted: vi.fn(), onPollInteracted: vi.fn(),
    });
  }, { wrapper });
  return { hook, fetchMock };
}

function lockPuts(fetchMock: ReturnType<typeof stubBrowser>): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => String(url).includes("/api/scout-approach-lock") && init?.method === "PUT")
    .flatMap(([, init]) => {
      const body: unknown = JSON.parse(String(init?.body));
      return typeof body === "object" && body !== null ? [{ ...body }] : [];
    });
}

function recordedForYou(fetchMock: ReturnType<typeof stubBrowser>): boolean {
  return fetchMock.mock.calls.some(([url, init]) =>
    /\/api\/(skipped|dismissed|for-you)/.test(String(url)) && init?.method === "POST",
  );
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

test("the desk's own Next publishes its move off an unreplied Scout card", async () => {
  const fetchMock = stubBrowser();
  const task = setup(new Set(), { keepBrowser: true });

  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).includes("/api/scout-approach-lock") && init?.method === "PUT",
    )).toBe(true);
  });
  act(() => { task.result.current.onScoutNext(); });
  expect(readApproachLock(user.id)?.cardId).not.toBe(cardA.id);
  await waitFor(() => {
    const lockIds = fetchMock.mock.calls
      .filter(([url, init]) => String(url).includes("/api/scout-approach-lock") && init?.method === "PUT")
      .map(([, init]) => publishedLockCardId(JSON.parse(String(init?.body))));
    expect(lockIds[0]).toBe(cardA.id);
    expect(lockIds.length).toBeGreaterThan(1);
    expect(lockIds.at(-1)).not.toBe(cardA.id);
  });
  task.unmount();
});

test("the desk excludes server-released cards after loading its lock", async () => {
  const fetchMock = stubBrowser();
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const isLockRead = String(input).includes("/api/scout-approach-lock") && (init?.method ?? "GET") === "GET";
    const body = isLockRead
      ? {
          releasedIds: [cardA.id],
          task: { lock: { phase: "hold", cardId: null, surface: "for_you" }, version: 2, owner: "server" },
        }
      : {};
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
  writeApproachLock(user.id, { phase: "hold", cardId: null, surface: "for_you" });
  const task = renderHook(() => {
    const history = useDeskHistory({
      setStatus: vi.fn(), setThreads: vi.fn(), setActionBusy: vi.fn(), settings: DEFAULT_SETTINGS,
    }, user.id);
    return useApproachTask({
      authUser: user, writesEnabled: true, deskBootReady: true, agendaReady: true,
      agenda: "Help developers build reliable software and share useful engineering ideas.",
      curatedThreads: [cardA, cardB], forYouSuggestions: [],
      interactedIds: new Set(), interactedRetainedHistory: history.interactedRetainedHistory,
      dismissedHistory: [], dismissThread: null, searching: false,
      actForYou: vi.fn(), onSkip: vi.fn(), onDismiss: vi.fn(),
      onRefreshCoaching: vi.fn(), onHydrateInteracted: vi.fn(), onPollInteracted: vi.fn(),
    });
  }, { wrapper });

  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).includes("/api/scout-approach-lock") && init?.method === "PUT",
    )).toBe(true);
  });
  act(() => { task.result.current.onForYouNext(); });
  expect(readApproachLock(user.id)?.cardId).toBe(cardB.id);
  task.unmount();
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

test("a stale Next for the previous card cannot move the server-adopted lock", async () => {
  const fetchMock = stubBrowser();
  setup(new Set([cardB.id]), { keepBrowser: true });
  expect(readApproachLock(user.id)?.cardId).toBe(cardA.id);

  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const isLockRead = String(input).includes("/api/scout-approach-lock") && (init?.method ?? "GET") === "GET";
    const body = isLockRead
      ? { ok: true, card: null, task: { lock: { phase: "scout_reply", cardId: cardB.id, surface: null }, version: 5, owner: "server" } }
      : {};
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
  act(() => { liveStream().emit("approach_task", { version: 5 }); });

  await waitFor(() => expect(readApproachLock(user.id)?.cardId).toBe(cardB.id));
  await waitFor(() => {
    const published = fetchMock.mock.calls
      .filter(([url, init]) => String(url).includes("/api/scout-approach-lock") && init?.method === "PUT")
      .map(([, init]): unknown => JSON.parse(String(init?.body)));
    expect(published.map(publishedLockCardId)).toContain(cardB.id);
  });

  act(() => { liveStream().emit("approach_next", { fromCardId: cardA.id }); });
  expect(readApproachLock(user.id)?.cardId).toBe(cardB.id);
});

test("the extension's Next moves past an unreplied Scout card, as the desk's own Next does", () => {
  setup(new Set());
  expect(readApproachLock(user.id)?.cardId).toBe(cardA.id);
  act(() => { liveStream().emit("approach_next", { fromCardId: cardA.id }); });
  expect(readApproachLock(user.id)?.cardId).not.toBe(cardA.id);
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

test("the extension's Skip moves the desk to the next Scout card, as the desk's own Skip does, without recording it again", () => {
  const onSkip = vi.fn();
  const onDismiss = vi.fn();
  const actForYou = vi.fn();
  const fetchMock = stubBrowser();
  setup(new Set(), { keepBrowser: true, onSkip, onDismiss, actForYou });
  expect(readApproachLock(user.id)?.cardId).toBe(cardA.id);

  act(() => { liveStream().emit("approach_next", { fromCardId: cardB.id, action: "skip", kind: "scout" }); });
  expect(readApproachLock(user.id)?.cardId).toBe(cardA.id);

  act(() => { liveStream().emit("approach_next", { fromCardId: cardA.id, action: "skip", kind: "scout" }); });
  expect(readApproachLock(user.id)).toEqual({ phase: "scout_reply", cardId: cardB.id, surface: null });
  expect(onSkip).not.toHaveBeenCalled();
  expect(onDismiss).not.toHaveBeenCalled();
  expect(actForYou).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.some(([url, init]) =>
    /\/api\/(skipped|dismissed|for-you)/.test(String(url)) && init?.method === "POST",
  )).toBe(false);
});

test("the extension's Not interested moves the desk to the next Scout card where a plain Next would go to For You", () => {
  setup(new Set());
  act(() => { liveStream().emit("approach_next", { fromCardId: cardA.id, action: "dismiss", kind: "scout" }); });
  expect(readApproachLock(user.id)?.cardId).toBe(cardB.id);
});

test("a plain Next from the same card goes to For You, not the next Scout card", () => {
  setup(new Set());
  act(() => { liveStream().emit("approach_next", { fromCardId: cardA.id }); });
  expect(readApproachLock(user.id)?.surface).toBe("for_you");
});

test("a Skip that arrives while the desk is off the dashboard applies as a Skip when the dashboard opens", () => {
  stubBrowser();
  const account = mountStreamOnly();
  act(() => { liveStream().emit("approach_next", { fromCardId: cardA.id, action: "skip", kind: "scout" }); });
  account.unmount();

  setup(new Set(), { keepBrowser: true });
  expect(readApproachLock(user.id)?.cardId).toBe(cardB.id);
});

test("the desk re-reads the history a panel Skip or Not interested changed", async () => {
  const fetchMock = stubBrowser();
  const account = mountStreamOnly();
  const reads = (path: string) => fetchMock.mock.calls.filter(([url, init]) =>
    String(url).endsWith(path) && (init?.method ?? "GET") === "GET",
  ).length;

  act(() => { liveStream().emit("approach_action", { action: "skip", fromCardId: cardA.id, kind: "scout" }); });
  await waitFor(() => expect(reads("/api/skipped")).toBe(1));
  expect(reads("/api/dismissed")).toBe(0);

  act(() => { liveStream().emit("approach_action", { action: "dismiss", fromCardId: cardA.id, kind: "scout" }); });
  await waitFor(() => expect(reads("/api/dismissed")).toBe(1));

  act(() => { liveStream().emit("approach_action", { action: "skip", fromCardId: "s1", kind: "suggestion" }); });
  await waitFor(() => expect(reads("/api/for-you")).toBe(1));
  expect(reads("/api/skipped")).toBe(1);

  act(() => { liveStream().emit("approach_action", { action: "next", fromCardId: cardA.id, kind: "scout" }); });
  expect(reads("/api/skipped")).toBe(1);
  account.unmount();
});

test("the desk publishes the original post suggestion it shows, for the extension to show the same card", async () => {
  const { fetchMock } = setupSuggested(postSuggestion);
  await waitFor(() => expect(lockPuts(fetchMock).length).toBeGreaterThan(0));
  const put = lockPuts(fetchMock).at(-1);
  expect(put?.card).toBeNull();
  expect(put?.next).toBeUndefined();
  expect(put?.lock).toEqual({ phase: "organic_reply", cardId: postSuggestion.id, surface: null });
  expect(put?.state).toEqual({
    view: "suggestion",
    detected: false,
    suggestion: {
      id: postSuggestion.id,
      kind: "post",
      why: postSuggestion.why,
      targetId: null,
      targetUrl: null,
      targetAuthor: null,
      openUrl: "https://x.com/home",
    },
  });
});

test("the desk publishes a suggested reply with its target card and the suggestion", async () => {
  const { fetchMock } = setupSuggested(replySuggestion);
  await waitFor(() => expect(lockPuts(fetchMock).length).toBeGreaterThan(0));
  const put = lockPuts(fetchMock).at(-1);
  expect(put?.card).toMatchObject({ id: "900", surface: "reply", author: "@erin" });
  expect(put?.state).toMatchObject({ view: "suggestion", suggestion: { id: replySuggestion.id, kind: "reply", targetId: "900" } });
});

test("the extension's I posted on X moves the desk off an original post, as the desk's own button does, without recording it again", () => {
  const actForYou = vi.fn();
  const { fetchMock } = setupSuggested(postSuggestion, { actForYou });

  act(() => { liveStream().emit("approach_next", { fromCardId: "other", action: "posted", kind: "suggestion" }); });
  expect(readApproachLock(user.id)?.cardId).toBe(postSuggestion.id);

  act(() => { liveStream().emit("approach_next", { fromCardId: postSuggestion.id, action: "posted", kind: "suggestion" }); });
  expect(readApproachLock(user.id)).toEqual({ phase: "scout_reply", cardId: cardA.id, surface: null });
  expect(actForYou).not.toHaveBeenCalled();
  expect(recordedForYou(fetchMock)).toBe(false);
});

test("the extension's Next on a detected suggested reply moves the desk on as the desk's Next does", () => {
  const actForYou = vi.fn();
  const { fetchMock } = setupSuggested(replySuggestion, {
    threads: [],
    suggestions: [replySuggestion, otherReplySuggestion],
    actForYou,
  });

  act(() => { liveStream().emit("approach_next", { fromCardId: replySuggestion.id, action: "posted", kind: "suggestion" }); });
  expect(readApproachLock(user.id)).toEqual({ phase: "organic_reply", cardId: otherReplySuggestion.id, surface: null });
  expect(actForYou).not.toHaveBeenCalled();
  expect(recordedForYou(fetchMock)).toBe(false);
});

test("the extension's Skip and Not interested move the desk off an original post card", () => {
  setupSuggested(postSuggestion);
  act(() => { liveStream().emit("approach_next", { fromCardId: postSuggestion.id, action: "skip", kind: "suggestion" }); });
  expect(readApproachLock(user.id)?.cardId).toBe(cardA.id);
});

test("the desk refreshes coaching and For You after the extension's I posted on X", async () => {
  const onRefreshCoaching = vi.fn();
  const { fetchMock } = setupSuggested(postSuggestion, { onRefreshCoaching });
  const forYouReads = () => fetchMock.mock.calls.filter(([url, init]) =>
    String(url).endsWith("/api/for-you") && (init?.method ?? "GET") === "GET",
  ).length;
  const before = forYouReads();
  onRefreshCoaching.mockClear();

  act(() => { liveStream().emit("approach_action", { action: "posted", fromCardId: postSuggestion.id, kind: "suggestion" }); });
  await waitFor(() => expect(forYouReads()).toBe(before + 1));
  expect(onRefreshCoaching).toHaveBeenCalledTimes(1);
  expect(recordedForYou(fetchMock)).toBe(false);
});
