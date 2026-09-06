import { normalizeAuthorKey } from "./interactionCooldown.js";
import type { ThreadCard } from "./threadCard.js";

export const SCOUT_RESERVE_CAPACITY = 40;
export const SCOUT_TANK_CAPACITY = 20;

export type ScoutReserve = ThreadCard[];

export function admitScoutPage(opts: {
  candidates: ThreadCard[];
  reserve: ScoutReserve;
  bucket: ThreadCard[];
  bucketSize: number;
  seenAuthors: Set<string>;
  acceptedIds: Set<string>;
}): {
  added: number;
  authorDedupe: number;
  authorless: number;
  bucketFull: number;
} {
  const before = opts.bucket.length;
  let authorDedupe = 0;
  let authorless = 0;
  let bucketFull = 0;
  for (let index = 0; index < opts.candidates.length; index += 1) {
    const thread = opts.candidates[index];
    if (opts.bucket.length >= opts.bucketSize) {
      const overflow = opts.candidates.slice(index);
      bucketFull = overflow.length;
      reserveScoutCandidates(opts.reserve, overflow);
      break;
    }
    const key = normalizeAuthorKey(thread.author);
    if (!key) {
      authorless += 1;
      continue;
    }
    if (opts.seenAuthors.has(key)) {
      authorDedupe += 1;
      continue;
    }
    opts.seenAuthors.add(key);
    opts.acceptedIds.add(thread.id);
    opts.bucket.push(thread);
  }
  return {
    added: opts.bucket.length - before,
    authorDedupe,
    authorless,
    bucketFull,
  };
}

/** Append paid hard-filter survivors, dropping the oldest when capacity is exceeded. */
export function reserveScoutCandidates(
  reserve: ScoutReserve,
  candidates: ThreadCard[],
  capacity = SCOUT_RESERVE_CAPACITY,
): number {
  const ids = new Set(reserve.map((thread) => thread.id));
  let added = 0;
  for (const thread of candidates) {
    if (!thread.id || ids.has(thread.id)) continue;
    reserve.push(thread);
    ids.add(thread.id);
    added += 1;
  }
  const overflow = Math.max(0, reserve.length - capacity);
  if (overflow) reserve.splice(0, overflow);
  return added;
}

/** Move oldest eligible survivors into the next bucket before another X read. */
export function drainScoutReserve(opts: {
  reserve: ScoutReserve;
  bucket: ThreadCard[];
  bucketSize: number;
  seenAuthors: Set<string>;
  acceptedIds: Set<string>;
  blockedConversations: Set<string>;
}): { added: number; authorDedupe: number; authorless: number; blocked: number } {
  let added = 0;
  let authorDedupe = 0;
  let authorless = 0;
  let blocked = 0;
  while (opts.reserve.length && opts.bucket.length < opts.bucketSize) {
    const thread = opts.reserve.shift();
    if (!thread) break;
    if (
      !thread.id ||
      opts.acceptedIds.has(thread.id) ||
      opts.blockedConversations.has(thread.id) ||
      Boolean(
        thread.conversationId &&
          opts.blockedConversations.has(thread.conversationId),
      )
    ) {
      blocked += 1;
      continue;
    }
    const key = normalizeAuthorKey(thread.author);
    if (!key) {
      authorless += 1;
      continue;
    }
    if (opts.seenAuthors.has(key)) {
      authorDedupe += 1;
      continue;
    }
    opts.seenAuthors.add(key);
    opts.acceptedIds.add(thread.id);
    opts.bucket.push(thread);
    added += 1;
  }
  return { added, authorDedupe, authorless, blocked };
}

/** Append every qualified card in stable order, bounded by the tank ceiling. */
export function appendScoutTank(opts: {
  tank: ThreadCard[];
  candidates: ThreadCard[];
  tankIds: Set<string>;
  tankAuthors: Set<string>;
  acceptedIds?: Set<string>;
  capacity?: number;
}): number {
  const before = opts.tank.length;
  const capacity = opts.capacity ?? SCOUT_TANK_CAPACITY;
  for (const thread of opts.candidates) {
    if (opts.tank.length >= capacity) break;
    const key = normalizeAuthorKey(thread.author);
    if (!thread.id || !key) continue;
    if (opts.tankIds.has(thread.id) || opts.tankAuthors.has(key)) continue;
    opts.tank.push(thread);
    opts.tankIds.add(thread.id);
    opts.tankAuthors.add(key);
    opts.acceptedIds?.delete(thread.id);
  }
  return opts.tank.length - before;
}
