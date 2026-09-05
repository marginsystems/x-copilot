/** Desk pace gate after a reply is marked interacted. Not an X quota. */

export const REPLY_PACE_MS = 60_000;
export const REPLY_PACE_STORAGE_KEY = "x-copilot-reply-pace-until";
export const REPLY_PACE_EVENT = "x-copilot-reply-pace";

export const REPLY_PACE_LEAD = "One reply a minute.";
export const REPLY_PACE_HELP =
  "After you mark interacted we hold scouted replies for 60 seconds. That is a desk gate, not a published X number. It keeps you from firing five replies a minute.";

export function nextReplyPaceUntil(now: number): number {
  return now + REPLY_PACE_MS;
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

export function replyPaceHoldActive(
  until: number | null,
  now: number = Date.now(),
): boolean {
  return replyPaceLocked(until, now);
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
