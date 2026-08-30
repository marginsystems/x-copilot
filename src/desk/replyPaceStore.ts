import {
  nextReplyPaceUntil,
  parseReplyPaceUntil,
  REPLY_PACE_EVENT,
  REPLY_PACE_STORAGE_KEY,
} from "../lib/replyPace";

export function readReplyPaceUntil(): number | null {
  try {
    return parseReplyPaceUntil(sessionStorage.getItem(REPLY_PACE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function armReplyPace(now = Date.now()): number {
  const until = nextReplyPaceUntil(now);
  try {
    sessionStorage.setItem(REPLY_PACE_STORAGE_KEY, String(until));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(REPLY_PACE_EVENT));
  return until;
}

export function clearReplyPace(): void {
  try {
    sessionStorage.removeItem(REPLY_PACE_STORAGE_KEY);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(REPLY_PACE_EVENT));
}
