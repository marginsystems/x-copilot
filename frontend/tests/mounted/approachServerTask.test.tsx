import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SessionBoundary } from "../../src/auth/session";
import type { AuthSessionUser } from "../../src/auth/types";
import { SERVER_TASK_CHECK_MS, useApproachTask } from "../../src/desk/useApproachTask";
import { readApproachLock, writeApproachLock } from "../../src/lib/approachLockStore";
import type { ThreadCard } from "../../../shared/src/deskTypes";

const user: AuthSessionUser = {
  id: "owner", email: null, displayName: null, avatarUrl: null,
  onboardingCompleted: true, agenda: null, xUsername: "owner",
  xLinked: true, isAdmin: false,
};

const cardA: ThreadCard = { id: "1001", author: "@alice", text: "first", url: "https://x.com/alice/status/1001" };
const cardB: ThreadCard = { id: "1002", author: "@bob", text: "second", url: "https://x.com/bob/status/1002" };

class QuietEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = QuietEventSource.OPEN;
  close() {
    this.readyState = QuietEventSource.CLOSED;
  }
}

function wrapper({ children }: { children: ReactNode }) {
  return <StrictMode><SessionBoundary>{children}</SessionBoundary></StrictMode>;
}

type LockRead = () => Promise<Response>;

function stubBrowser(lockRead: LockRead) {
  vi.stubGlobal("EventSource", QuietEventSource);
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const isLockRead = String(input).includes("/api/scout-approach-lock") && (init?.method ?? "GET") === "GET";
    return isLockRead ? lockRead() : Promise.resolve(new Response("{}"));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lockPuts(fetchMock: ReturnType<typeof stubBrowser>): unknown[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => String(url).includes("/api/scout-approach-lock") && init?.method === "PUT")
    .map(([, init]): unknown => JSON.parse(String(init?.body)));
}

function publishedOnly(fetchMock: ReturnType<typeof stubBrowser>, cardId: string) {
  for (const body of lockPuts(fetchMock)) expect(body).toMatchObject({ lock: { cardId } });
}

function mount() {
  writeApproachLock(user.id, { phase: "scout_reply", cardId: cardA.id, surface: null });
  return renderHook(() => useApproachTask({
    authUser: user, writesEnabled: true, deskBootReady: true, agendaReady: true,
    agenda: "Help developers build reliable software and share useful engineering ideas.",
    curatedThreads: [cardA, cardB], forYouSuggestions: [],
    interactedIds: new Set(), interactedRetainedHistory: [],
    dismissedHistory: [], dismissThread: null, searching: false,
    actForYou: vi.fn(), onSkip: vi.fn(), onDismiss: vi.fn(),
    onRefreshCoaching: vi.fn(), onHydrateInteracted: vi.fn(), onPollInteracted: vi.fn(),
  }), { wrapper });
}

const taskAnswer = (owner: "desk" | "server", cardId: string) =>
  new Response(JSON.stringify({
    ok: true,
    card: null,
    task: { lock: { phase: "scout_reply", cardId, surface: null }, version: 3, owner, updatedAt: "2026-10-04T00:00:00.000Z" },
  }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

test("the desk adopts the card the server moved to while no desk was open, then publishes it as its own", async () => {
  const fetchMock = stubBrowser(() => Promise.resolve(taskAnswer("server", cardB.id)));
  const task = mount();

  await waitFor(() => expect(readApproachLock(user.id)?.cardId).toBe(cardB.id));
  await waitFor(() => expect(lockPuts(fetchMock).length).toBeGreaterThan(0));
  publishedOnly(fetchMock, cardB.id);

  task.unmount();
});

test("the desk keeps its own card when the server's lock is one a desk wrote", async () => {
  const fetchMock = stubBrowser(() => Promise.resolve(taskAnswer("desk", cardB.id)));
  const task = mount();

  await waitFor(() => expect(lockPuts(fetchMock).length).toBeGreaterThan(0));
  expect(readApproachLock(user.id)?.cardId).toBe(cardA.id);
  publishedOnly(fetchMock, cardA.id);

  task.unmount();
});

test("the desk does not publish its lock before it has checked the server's", async () => {
  let answer!: (response: Response) => void;
  const fetchMock = stubBrowser(() => new Promise<Response>((resolve) => { answer = resolve; }));
  const task = mount();

  await act(async () => { await Promise.resolve(); });
  expect(lockPuts(fetchMock)).toHaveLength(0);

  await act(async () => { answer(taskAnswer("server", cardB.id)); });
  await waitFor(() => expect(lockPuts(fetchMock).length).toBeGreaterThan(0));
  publishedOnly(fetchMock, cardB.id);

  task.unmount();
});

test("the desk publishes its own lock when the server check fails or never answers", async () => {
  const failing = stubBrowser(() => Promise.reject(new Error("offline")));
  const failed = mount();
  await waitFor(() => expect(lockPuts(failing).length).toBeGreaterThan(0));
  expect(readApproachLock(user.id)?.cardId).toBe(cardA.id);
  failed.unmount();

  vi.useFakeTimers();
  const silent = stubBrowser(() => new Promise<Response>(() => undefined));
  const waiting = mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(SERVER_TASK_CHECK_MS - 1); });
  expect(lockPuts(silent)).toHaveLength(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(2); });
  expect(lockPuts(silent).length).toBeGreaterThan(0);
  waiting.unmount();
});
