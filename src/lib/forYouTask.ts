/**
 * The For You wait belongs to one presented task. Detection reads one activity
 * cursor — the newest own post or attributed reply the desk already knows.
 * Scout still matches a specific card; this cursor only answers "anything new?"
 */

import type { OwnActivity } from "./coaching";
import type { InteractionHistoryEntry } from "../desk/types";

export const FOR_YOU_WAIT_STORAGE_KEY = "x-copilot-fyp-wait-v2";

export type ActivityCursor = OwnActivity;

export type ForYouWaitSnapshot = {
  id: string;
  postedAt: string;
};

export type ForYouWait = {
  held: true;
  kind: "for_you";
  /** User the wait belongs to. A wait never runs behind another operator's card. */
  owner: string;
  /** When the task was presented. Fallback baseline when no cursor existed yet. */
  enteredAt: string;
  /** Newest known activity at entry, or the first payload that did not post-date entry. */
  snapshot: ForYouWaitSnapshot | null;
  /** Set once. Later cursor moves cannot un-detect the task. */
  detectedAt: string | null;
  /** The cursor that closed the wait. Frozen at detect time. */
  hit: ActivityCursor | null;
};

function cursorTime(cursor: Pick<ActivityCursor, "postedAt">): number {
  return Date.parse(cursor.postedAt);
}

function newerThan(cursor: ActivityCursor | null, iso: string): boolean {
  return Boolean(cursor && cursorTime(cursor) > Date.parse(iso));
}

function snapshotFrom(cursor: ActivityCursor): ForYouWaitSnapshot {
  return { id: cursor.id, postedAt: cursor.postedAt };
}

function historyCursor(
  history?: Array<
    Pick<InteractionHistoryEntry, "replyId" | "replyUrl" | "postedAt" | "at">
  >,
): ActivityCursor | null {
  if (!history) return null;
  let best: ActivityCursor | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const row of history) {
    const id = row.replyId?.trim();
    const postedAt = row.postedAt?.trim() || row.at?.trim();
    if (!id || !postedAt) continue;
    const postedMs = Date.parse(postedAt);
    if (!Number.isFinite(postedMs) || postedMs < bestMs) continue;
    bestMs = postedMs;
    best = {
      id,
      postedAt,
      kind: "reply",
      url: row.replyUrl?.trim() || `https://x.com/i/status/${id}`,
      text: "",
    };
  }
  return best;
}

/**
 * Newest own activity the desk already has. Prefers the later postedAt; same
 * id keeps ownActivity display fields (url / text).
 */
export function latestActivityCursor(opts: {
  ownActivity?: ActivityCursor | null;
  history?: Array<
    Pick<InteractionHistoryEntry, "replyId" | "replyUrl" | "postedAt" | "at">
  >;
}): ActivityCursor | null {
  const fromOwn = opts.ownActivity?.id?.trim()
    ? opts.ownActivity
    : null;
  const fromHistory = historyCursor(opts.history);
  if (!fromOwn) return fromHistory;
  if (!fromHistory) return fromOwn;
  if (fromOwn.id === fromHistory.id) {
    return {
      ...fromHistory,
      ...fromOwn,
      url: fromOwn.url || fromHistory.url,
      text: fromOwn.text,
    };
  }
  return cursorTime(fromOwn) >= cursorTime(fromHistory) ? fromOwn : fromHistory;
}

export function snapshotForYouWait(
  cursor?: ActivityCursor | null,
): ForYouWaitSnapshot | null {
  return cursor?.id ? snapshotFrom(cursor) : null;
}

/** A fresh wait for a task that was just presented. */
export function openForYouWait(opts: {
  owner: string;
  cursor?: ActivityCursor | null;
  now?: number;
}): ForYouWait {
  return {
    held: true,
    kind: "for_you",
    owner: opts.owner,
    enteredAt: new Date(opts.now ?? Date.now()).toISOString(),
    snapshot: snapshotForYouWait(opts.cursor),
    detectedAt: null,
    hit: null,
  };
}

/** A different post that is newer than the baseline and the wait's entry. */
export function hasDetectedForYouPost(
  snapshot: ForYouWaitSnapshot,
  cursor?: ActivityCursor | null,
  enteredAt?: string,
): boolean {
  if (!cursor || cursor.id === snapshot.id) return false;
  if (!newerThan(cursor, snapshot.postedAt)) return false;
  if (enteredAt && !newerThan(cursor, enteredAt)) return false;
  return true;
}

export function forYouWaitDetected(
  wait: ForYouWait,
  cursor?: ActivityCursor | null,
): boolean {
  if (wait.detectedAt) return true;
  if (!cursor) return false;
  if (wait.snapshot) {
    return hasDetectedForYouPost(wait.snapshot, cursor, wait.enteredAt);
  }
  return newerThan(cursor, wait.enteredAt);
}

/** The cursor that closed the wait — never the baseline post. */
export function forYouDetectedActivity(
  wait: ForYouWait,
  cursor?: ActivityCursor | null,
): ActivityCursor | null {
  if (wait.hit) return wait.hit;
  if (!forYouWaitDetected(wait, cursor) || !cursor) return null;
  if (wait.snapshot && cursor.id === wait.snapshot.id) return null;
  return cursor;
}

/**
 * Fold one cursor into the wait. A late cursor becomes the baseline only when
 * it does not post-date entry; otherwise the task is marked detected.
 */
export function settleForYouWait(
  wait: ForYouWait,
  cursor?: ActivityCursor | null,
  now: number = Date.now(),
): ForYouWait {
  if (wait.detectedAt || !cursor) return wait;
  const detectedAt = new Date(now).toISOString();
  if (!wait.snapshot) {
    if (newerThan(cursor, wait.enteredAt)) {
      return { ...wait, detectedAt, hit: cursor };
    }
    return { ...wait, snapshot: snapshotForYouWait(cursor) };
  }
  if (hasDetectedForYouPost(wait.snapshot, cursor, wait.enteredAt)) {
    return { ...wait, detectedAt, hit: cursor };
  }
  return wait;
}

function storageKey(owner: string): string {
  return `${FOR_YOU_WAIT_STORAGE_KEY}:${owner}`;
}

function parseSnapshot(raw: unknown): ForYouWaitSnapshot | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const snapshot = raw as Record<string, unknown>;
  if (typeof snapshot.id !== "string" || !snapshot.id.trim()) return undefined;
  if (typeof snapshot.postedAt !== "string" || !snapshot.postedAt.trim()) {
    return undefined;
  }
  return { id: snapshot.id, postedAt: snapshot.postedAt };
}

function parseHit(raw: unknown): ActivityCursor | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    !row.id.trim() ||
    typeof row.postedAt !== "string" ||
    !row.postedAt.trim() ||
    typeof row.url !== "string" ||
    typeof row.text !== "string" ||
    (row.kind !== "reply" && row.kind !== "original" && row.kind !== "quote")
  ) {
    return undefined;
  }
  return {
    id: row.id,
    postedAt: row.postedAt,
    kind: row.kind,
    url: row.url,
    text: row.text,
  };
}

export function parseForYouWait(
  raw: string | null,
  owner: string,
): ForYouWait | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Record<string, unknown>;
    if (row.held !== true || row.kind !== "for_you") return null;
    if (row.owner !== owner) return null;
    if (typeof row.enteredAt !== "string") return null;
    if (row.detectedAt !== null && typeof row.detectedAt !== "string") {
      return null;
    }
    const snapshot = parseSnapshot(row.snapshot);
    if (snapshot === undefined) return null;
    const hit = parseHit(row.hit);
    if (hit === undefined) return null;
    return {
      held: true,
      kind: "for_you",
      owner,
      enteredAt: row.enteredAt,
      snapshot,
      detectedAt: row.detectedAt as string | null,
      hit,
    };
  } catch {
    return null;
  }
}

export function readForYouWait(owner: string): ForYouWait | null {
  try {
    return parseForYouWait(sessionStorage.getItem(storageKey(owner)), owner);
  } catch {
    return null;
  }
}

export function writeForYouWait(wait: ForYouWait): void {
  try {
    sessionStorage.setItem(storageKey(wait.owner), JSON.stringify(wait));
  } catch {
    /* private mode */
  }
}

export function clearForYouWait(owner: string): void {
  try {
    sessionStorage.removeItem(storageKey(owner));
  } catch {
    /* private mode */
  }
}
