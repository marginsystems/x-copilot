import {
  nextReplyPaceUntil,
  parseReplyPaceUntil,
  REPLY_PACE_CLEARED_KEY,
  REPLY_PACE_EVENT,
  REPLY_PACE_STORAGE_KEY,
  seedReplyPaceUntil,
} from "../lib/replyPace";

export function readReplyPaceUntil(): number | null {
  try {
    return parseReplyPaceUntil(sessionStorage.getItem(REPLY_PACE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function readReplyPaceCleared(): boolean {
  try {
    return sessionStorage.getItem(REPLY_PACE_CLEARED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeUntil(until: number): void {
  try {
    sessionStorage.removeItem(REPLY_PACE_CLEARED_KEY);
    sessionStorage.setItem(REPLY_PACE_STORAGE_KEY, String(until));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(REPLY_PACE_EVENT));
}

export function armReplyPace(now = Date.now()): number {
  const until = nextReplyPaceUntil(now);
  writeUntil(until);
  return until;
}

export function seedReplyPaceFromReplyAt(
  replyAtIso: string | null | undefined,
  now = Date.now(),
): number | null {
  const until = seedReplyPaceUntil({
    storedUntil: readReplyPaceUntil(),
    cleared: readReplyPaceCleared(),
    replyAtIso,
    nowMs: now,
  });
  if (until == null || until === readReplyPaceUntil()) return until;
  writeUntil(until);
  return until;
}

export function clearReplyPace(): void {
  try {
    sessionStorage.removeItem(REPLY_PACE_STORAGE_KEY);
    sessionStorage.setItem(REPLY_PACE_CLEARED_KEY, "1");
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(REPLY_PACE_EVENT));
}
