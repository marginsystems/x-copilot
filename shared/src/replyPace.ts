/** Desk pace clock after a reply is recorded. Overlay waits for Next. Not an X quota. */

export const REPLY_PACE_MS = 60_000;
export const REPLY_PACE_STORAGE_KEY = "x-copilot-reply-pace-until";
export const REPLY_PACE_CLEARED_KEY = "x-copilot-reply-pace-cleared";
export const REPLY_PACE_EVENT = "x-copilot-reply-pace";

export function replyPaceTip(clock: string): string {
  return `Next reply in ${clock}. One reply a minute keeps the account from looking automated.`;
}

export function nextReplyPaceUntil(now: number): number {
  return now + REPLY_PACE_MS;
}

export function replyPaceSeedIso(opts: {
  replyAtIso?: string | null;
  ownActivity?: { kind: string; postedAt: string } | null;
}): string | null | undefined {
  const ownActivity = opts.ownActivity;
  if (ownActivity?.kind !== "reply") return opts.replyAtIso;
  const ownReplyAt = Date.parse(ownActivity.postedAt);
  if (!Number.isFinite(ownReplyAt)) return opts.replyAtIso;
  const historyReplyAt = opts.replyAtIso ? Date.parse(opts.replyAtIso) : NaN;
  return !Number.isFinite(historyReplyAt) || ownReplyAt > historyReplyAt
    ? ownActivity.postedAt
    : opts.replyAtIso;
}

/** Record a reply timestamp so Next can overlay the incoming card. */
export function seedReplyPaceUntil(opts: {
  storedUntil: number | null;
  cleared: boolean;
  replyAtIso?: string | null;
  nowMs: number;
}): number | null {
  if (opts.storedUntil != null && opts.storedUntil > opts.nowMs) {
    return opts.storedUntil;
  }
  if (opts.cleared) return null;
  const at = opts.replyAtIso ? Date.parse(opts.replyAtIso) : NaN;
  if (!Number.isFinite(at)) return null;
  const until = at + REPLY_PACE_MS;
  if (until <= opts.nowMs) return null;
  return until;
}

export function parseReplyPaceUntil(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function replyPaceRemainingMs(until: number | null, now: number): number {
  if (until == null) return 0;
  return Math.max(0, until - now);
}

export function replyPaceLocked(until: number | null, now: number): boolean {
  return replyPaceRemainingMs(until, now) > 0;
}

export function formatReplyPaceClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
