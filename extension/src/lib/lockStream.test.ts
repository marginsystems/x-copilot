import { describe, expect, it, vi } from "vitest";
import {
  LOCK_EVENTS_PATH,
  LOCK_STREAM_RETRY_MAX_MS,
  LOCK_STREAM_RETRY_MIN_MS,
  LOCK_STREAM_UNSUPPORTED_RETRY_MS,
  lockStreamRetryMs,
  takeStreamEvents,
  watchLock,
  type LockStreamDeps,
} from "./lockStream";

const pairing = { apiBase: "https://api.xcopilot.dev", token: "token" };

function streamResponse() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(started) {
      controller = started;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(body, { status: 200 }),
    push: (text: string) => controller?.enqueue(encoder.encode(text)),
    close: () => controller?.close(),
  };
}

function harness(responses: Array<Response | Error>) {
  const timers: Array<{ run: () => void; ms: number; cleared: boolean }> = [];
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) return new Promise<Response>(() => undefined);
    if (next instanceof Error) throw next;
    return next;
  });
  const deps: LockStreamDeps = {
    fetch: fetchMock as unknown as typeof fetch,
    setTimeout: (run, ms) => {
      const timer = { run, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      if (timer) (timer as { cleared: boolean }).cleared = true;
    },
  };
  const retries = () => timers.filter((timer) => !timer.cleared && timer.ms !== 45_000);
  return { deps, fetchMock, retries };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("takeStreamEvents", () => {
  it("returns the names of complete frames and keeps the partial tail", () => {
    expect(takeStreamEvents("event: ready\ndata: {}\n\n: heartbeat\n\nevent: lock_cha")).toEqual({
      events: ["ready"],
      rest: "event: lock_cha",
    });
    expect(takeStreamEvents("event: lock_changed\r\ndata: {}\r\n\r\n")).toEqual({ events: ["lock_changed"], rest: "" });
  });
});

describe("lockStreamRetryMs", () => {
  it("backs off, waits long on a server without the stream, and stops when signed out", () => {
    expect(lockStreamRetryMs(null, 1)).toBe(LOCK_STREAM_RETRY_MIN_MS);
    expect(lockStreamRetryMs(500, 3)).toBe(LOCK_STREAM_RETRY_MIN_MS * 4);
    expect(lockStreamRetryMs(null, 30)).toBe(LOCK_STREAM_RETRY_MAX_MS);
    expect(lockStreamRetryMs(404, 1)).toBe(LOCK_STREAM_UNSUPPORTED_RETRY_MS);
    expect(lockStreamRetryMs(401, 1)).toBeNull();
  });
});

describe("watchLock", () => {
  it("reports each lock change as it arrives, with the extension's bearer token", async () => {
    const stream = streamResponse();
    const { deps, fetchMock } = harness([stream.response]);
    const onChange = vi.fn();
    const stop = watchLock(pairing, onChange, deps);
    await settle();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${pairing.apiBase}${LOCK_EVENTS_PATH}`);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer token" });
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("omit");

    stream.push("event: ready\ndata: {}\n\n");
    await settle();
    expect(onChange).not.toHaveBeenCalled();

    stream.push("event: lock_changed\nda");
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    stream.push("ta: {}\n\n: heartbeat\n\nevent: lock_changed\ndata: {}\n\n");
    await settle();
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
  });

  it("reconnects after the stream drops and catches up once it is back", async () => {
    const first = streamResponse();
    const second = streamResponse();
    const { deps, fetchMock, retries } = harness([first.response, second.response]);
    const onChange = vi.fn();
    const stop = watchLock(pairing, onChange, deps);
    await settle();
    first.push("event: ready\ndata: {}\n\n");
    await settle();
    first.close();
    await settle();

    expect(retries()).toHaveLength(1);
    expect(retries()[0]?.ms).toBe(LOCK_STREAM_RETRY_MIN_MS);
    retries()[0]?.run();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    second.push("event: ready\ndata: {}\n\n");
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("catches up when the first connection attempt fails", async () => {
    const stream = streamResponse();
    const { deps, fetchMock, retries } = harness([new Error("network failure"), stream.response]);
    const onChange = vi.fn();
    const stop = watchLock(pairing, onChange, deps);
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(retries()).toHaveLength(1);
    expect(retries()[0]?.ms).toBe(LOCK_STREAM_RETRY_MIN_MS);
    retries()[0]?.run();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    stream.push("event: ready\ndata: {}\n\n");
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("waits long on a server without the stream and gives up when signed out", async () => {
    const older = harness([new Response("{}", { status: 404 })]);
    const stopOlder = watchLock(pairing, vi.fn(), older.deps);
    await settle();
    expect(older.retries().map((timer) => timer.ms)).toEqual([LOCK_STREAM_UNSUPPORTED_RETRY_MS]);
    stopOlder();

    const signedOut = harness([new Response("{}", { status: 401 })]);
    watchLock(pairing, vi.fn(), signedOut.deps);
    await settle();
    expect(signedOut.retries()).toHaveLength(0);
  });

  it("stops listening and does not reconnect once stopped", async () => {
    const stream = streamResponse();
    const { deps, fetchMock, retries } = harness([stream.response]);
    const onChange = vi.fn();
    const stop = watchLock(pairing, onChange, deps);
    await settle();
    stop();
    expect((fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true);
    stream.close();
    await settle();
    expect(retries()).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });
});
