import type { ThreadCard } from "./threadCard.js";

export const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_FILTERED_AUTHORS = 12;

/** Parse x.com / twitter.com status URL → numeric rest id. */
export function parseStatusIdFromUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (
      host !== "x.com" &&
      host !== "twitter.com" &&
      host !== "mobile.twitter.com"
    ) {
      return null;
    }
    const match = parsed.pathname.match(/\/status(?:es)?\/(\d+)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Normalize "@Foo " / "Foo" → "foo". */
export function normalizeAuthorKey(author: string): string {
  return author.trim().replace(/^@+/, "").toLowerCase();
}

export function isWithinCooldown(
  atIso: string,
  nowMs: number = Date.now(),
  windowMs: number = COOLDOWN_MS,
): boolean {
  const timestamp = Date.parse(atIso);
  if (!Number.isFinite(timestamp)) return false;
  const age = nowMs - timestamp;
  return age >= 0 && age < windowMs;
}

export function pruneExpired<T extends { at: string }>(
  interactions: T[],
  nowMs: number = Date.now(),
  windowMs: number = COOLDOWN_MS,
): T[] {
  return interactions.filter((item) =>
    isWithinCooldown(item.at, nowMs, windowMs),
  );
}

/**
 * Conversation / ancestry ids that should stay dark after an interaction.
 * Prefer conversationId (OP root), else inReplyToId, else the marked threadId.
 */
export function conversationRootId(row: {
  conversationId?: string;
  inReplyToId?: string;
  threadId?: string;
  id?: string;
}): string | null {
  const conversationId = row.conversationId?.trim();
  if (conversationId) return conversationId;
  const inReplyToId = row.inReplyToId?.trim();
  if (inReplyToId) return inReplyToId;
  const threadId = row.threadId?.trim() || row.id?.trim();
  return threadId || null;
}

/** True when a Scout card belongs to a blocked conversation / ancestry set. */
export function threadMatchesConversationIds(
  thread: ThreadCard,
  blockedIds: ReadonlySet<string>,
): boolean {
  if (!blockedIds.size) return false;
  if (blockedIds.has(thread.id)) return true;
  if (thread.conversationId && blockedIds.has(thread.conversationId)) {
    return true;
  }
  if (thread.inReplyToId && blockedIds.has(thread.inReplyToId)) return true;
  return false;
}

export function filterThreadsByCooldown(
  threads: ThreadCard[],
  cooledKeys: Set<string>,
  blockedConversationIds: ReadonlySet<string> = new Set(),
): {
  threads: ThreadCard[];
  filteredCount: number;
  filteredAuthors: string[];
} {
  if (!cooledKeys.size && !blockedConversationIds.size) {
    return { threads, filteredCount: 0, filteredAuthors: [] };
  }
  const kept: ThreadCard[] = [];
  const removedAuthors = new Set<string>();
  let filteredCount = 0;
  for (const thread of threads) {
    const key = normalizeAuthorKey(thread.author);
    if (key && cooledKeys.has(key)) {
      filteredCount += 1;
      removedAuthors.add(key);
      continue;
    }
    if (threadMatchesConversationIds(thread, blockedConversationIds)) {
      filteredCount += 1;
      if (key) removedAuthors.add(key);
      continue;
    }
    kept.push(thread);
  }
  return {
    threads: kept,
    filteredCount,
    filteredAuthors: [...removedAuthors].slice(0, MAX_FILTERED_AUTHORS),
  };
}

/** Row shape for conversation ancestry (interactions, dismissals, …). */
export type ConversationAncestryRow = {
  conversationId?: string;
  inReplyToId?: string;
  threadId?: string;
};

export function conversationIdsFromHistory(
  history: readonly ConversationAncestryRow[],
): Set<string> {
  const ids = new Set<string>();
  for (const row of history) {
    const root = conversationRootId(row);
    if (root) ids.add(root);
    if (row.threadId?.trim()) ids.add(row.threadId.trim());
    if (row.inReplyToId?.trim()) ids.add(row.inReplyToId.trim());
  }
  return ids;
}
