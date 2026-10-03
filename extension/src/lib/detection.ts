import type { ScoutApproachLockCard } from "../../../shared/src/scoutApproachLock";
import { isRecord } from "../../../shared/src/typeGuards";

export const CARD_SINCE_KEY = "panelCardSince";
export const FOR_YOU_CARD_KEY = "for_you";

export type CardSince = { key: string; sinceMs: number };

export function cardKey(lock: ScoutApproachLockCard | null): string {
  return lock ? `card:${lock.id}` : FOR_YOU_CARD_KEY;
}

export function parseCardSince(raw: unknown): CardSince | null {
  if (!isRecord(raw) || typeof raw.key !== "string" || !raw.key) return null;
  if (typeof raw.sinceMs !== "number" || !Number.isFinite(raw.sinceMs)) return null;
  return { key: raw.key, sinceMs: raw.sinceMs };
}

export function nextCardSince(previous: CardSince | null, key: string, nowMs: number): CardSince {
  return previous?.key === key ? previous : { key, sinceMs: nowMs };
}

export function cardDetected(opts: {
  lock: ScoutApproachLockCard | null;
  repliedCardId: string | null;
  replySeenAtMs: number | null;
  since: CardSince | null;
}): boolean {
  if (opts.lock) return opts.repliedCardId === opts.lock.id;
  if (opts.replySeenAtMs === null || !opts.since || opts.since.key !== FOR_YOU_CARD_KEY) return false;
  return opts.replySeenAtMs >= opts.since.sinceMs;
}

export type DetectionTag = { label: string; detected: boolean };

export function detectionTag(lock: ScoutApproachLockCard | null, detected: boolean): DetectionTag {
  if (lock) return { label: detected ? "Reply detected" : "Waiting for your reply", detected };
  return { label: detected ? "Post detected" : "Waiting for your post", detected };
}
