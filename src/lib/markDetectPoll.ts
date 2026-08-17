/** Client-driven Mark interacted detect polling (progress + wall-clock timeout). */

export const MARK_DETECT_POLL_INTERVAL_MS = 5000;
export const MARK_DETECT_TIMEOUT_MS = 30_000;

export type MarkDetectMissReason =
  | "none"
  | "ambiguous"
  | "search_failed"
  | "error"
  | "timeout";

export function markDetectCheckingNote(attempt: number): string {
  return `Checking… (${attempt})`;
}

export function markDetectWaitingNote(
  secondsLeft: number,
  nextAttempt: number,
): string {
  const secs = Math.max(1, secondsLeft);
  return `Waiting ${secs}s… (next check ${nextAttempt})`;
}

export function markDetectTimeoutNote(): string {
  return "Timed out looking for your reply. Post on X, then mark again.";
}

export function markDetectMissNote(reason?: string): string {
  if (reason === "ambiguous") {
    return "Multiple replies matched. Wait a moment and mark again.";
  }
  return "Couldn't find your reply. Post on X, then mark again.";
}

/** Soft misses that should keep polling until timeout. */
export function shouldContinueMarkDetectPoll(opts: {
  found: boolean;
  reason?: string;
  elapsedMs: number;
  timeoutMs?: number;
}): boolean {
  if (opts.found) return false;
  if (opts.reason === "ambiguous") return false;
  if (opts.reason === "error") return false;
  const timeout = opts.timeoutMs ?? MARK_DETECT_TIMEOUT_MS;
  if (opts.elapsedMs >= timeout) return false;
  return true;
}

/** Remaining wait before the next poll, clamped by the overall deadline. */
export function nextMarkDetectWaitMs(opts: {
  elapsedMs: number;
  intervalMs?: number;
  timeoutMs?: number;
}): number {
  const interval = opts.intervalMs ?? MARK_DETECT_POLL_INTERVAL_MS;
  const timeout = opts.timeoutMs ?? MARK_DETECT_TIMEOUT_MS;
  const remaining = timeout - opts.elapsedMs;
  if (remaining <= 0) return 0;
  return Math.min(interval, remaining);
}

export function sleepMs(
  ms: number,
  signal?: AbortSignal,
): Promise<"ok" | "aborted"> {
  if (ms <= 0) return Promise.resolve(signal?.aborted ? "aborted" : "ok");
  if (signal?.aborted) return Promise.resolve("aborted");
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(signal?.aborted ? "aborted" : "ok");
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve("aborted");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Wait up to `ms`, ticking about once per second with seconds remaining.
 * Stops early on abort.
 */
export async function waitWithCountdown(
  ms: number,
  opts: {
    signal?: AbortSignal;
    onTick: (secondsLeft: number) => void;
    now?: () => number;
    sleep?: typeof sleepMs;
  },
): Promise<"ok" | "aborted"> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? sleepMs;
  const end = now() + ms;
  while (now() < end) {
    if (opts.signal?.aborted) return "aborted";
    const leftMs = end - now();
    opts.onTick(Math.max(1, Math.ceil(leftMs / 1000)));
    const slice = Math.min(1000, leftMs);
    const waited = await sleep(slice, opts.signal);
    if (waited === "aborted") return "aborted";
  }
  return opts.signal?.aborted ? "aborted" : "ok";
}
