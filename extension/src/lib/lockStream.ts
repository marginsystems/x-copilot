import type { Pairing } from "./pairing";

export const LOCK_EVENTS_PATH = "/api/scout-approach-lock/events";
export const LOCK_CHANGED_EVENT = "lock_changed";
export const LOCK_READY_EVENT = "ready";
export const LOCK_STREAM_RETRY_MIN_MS = 1_000;
export const LOCK_STREAM_RETRY_MAX_MS = 30_000;
export const LOCK_STREAM_UNSUPPORTED_RETRY_MS = 5 * 60_000;
export const LOCK_STREAM_SILENCE_MS = 45_000;

export function takeStreamEvents(buffer: string): { events: string[]; rest: string } {
  const frames = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = frames.pop() ?? "";
  const events: string[] = [];
  for (const frame of frames) {
    const name = /^event: ?(.*)$/m.exec(frame)?.[1]?.trim();
    if (name) events.push(name);
  }
  return { events, rest };
}

export function lockStreamRetryMs(status: number | null, failures: number): number | null {
  if (status === 401) return null;
  if (status === 404 || status === 405) return LOCK_STREAM_UNSUPPORTED_RETRY_MS;
  return Math.min(LOCK_STREAM_RETRY_MIN_MS * 2 ** Math.max(0, failures - 1), LOCK_STREAM_RETRY_MAX_MS);
}

type StreamPairing = Pick<Pairing, "apiBase" | "token">;

export type LockStreamDeps = {
  fetch: typeof fetch;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
};

const BROWSER_DEPS: LockStreamDeps = {
  fetch: (input, init) => fetch(input, init),
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>),
};

export function watchLock(
  pairing: StreamPairing,
  onChange: () => void,
  deps: LockStreamDeps = BROWSER_DEPS,
): () => void {
  let stopped = false;
  let failures = 0;
  let connectedBefore = false;
  let abort: AbortController | null = null;
  let retryTimer: unknown;
  let silenceTimer: unknown;

  const armSilence = () => {
    deps.clearTimeout(silenceTimer);
    silenceTimer = deps.setTimeout(() => abort?.abort(), LOCK_STREAM_SILENCE_MS);
  };

  const handle = (event: string) => {
    if (event === LOCK_READY_EVENT) {
      if (connectedBefore || failures > 0) onChange();
      failures = 0;
      connectedBefore = true;
      return;
    }
    if (event === LOCK_CHANGED_EVENT) onChange();
  };

  const connect = async () => {
    if (stopped) return;
    abort = new AbortController();
    let status: number | null = null;
    try {
      armSilence();
      const res = await deps.fetch(`${pairing.apiBase}${LOCK_EVENTS_PATH}`, {
        credentials: "omit",
        headers: { Authorization: `Bearer ${pairing.token}`, Accept: "text/event-stream" },
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        status = res.status;
        throw new Error(`lock stream ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        armSilence();
        const taken = takeStreamEvents(buffer + decoder.decode(value, { stream: true }));
        buffer = taken.rest;
        for (const event of taken.events) handle(event);
      }
    } catch {
      failures += 1;
    } finally {
      deps.clearTimeout(silenceTimer);
    }
    if (stopped) return;
    const retryMs = lockStreamRetryMs(status, Math.max(1, failures));
    if (retryMs === null) return;
    retryTimer = deps.setTimeout(() => { connect().catch(() => undefined); }, retryMs);
  };

  connect().catch(() => undefined);

  return () => {
    stopped = true;
    deps.clearTimeout(retryTimer);
    deps.clearTimeout(silenceTimer);
    abort?.abort();
  };
}
