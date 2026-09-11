/** Desk pace gate after Mark detects a reply. Not an X quota. */

export const REPLY_PACE_MS = 60_000;
export const REPLY_PACE_STORAGE_KEY = "x-copilot-reply-pace-until";
export const REPLY_PACE_CLEARED_KEY = "x-copilot-reply-pace-cleared";
export const REPLY_PACE_EVENT = "x-copilot-reply-pace";

export const REPLY_PACE_LEAD = "One reply a minute.";
export const REPLY_PACE_HELP =
  "After any reply is detected, Approach waits 60 seconds before the next reply card. That is a desk gate, not a published X number. An original or quote during the minute still counts. Bypass if you must.";

export function nextReplyPaceUntil(now: number): number {
  return now + REPLY_PACE_MS;
}

/** Seed a hold from the last reply when this tab has no until and the operator did not Bypass. */
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
