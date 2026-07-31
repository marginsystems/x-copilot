/**
 * Deterministic post-search filters (length / thread openers / Articles / self-replies) before triage.
 */
import { normalizeAuthorKey } from "./interactionStore.js";
import type { ThreadCard } from "./xSearch.js";

export const DEFAULT_MAX_THREAD_CHARS = 480;

const THREAD_OPENER_RE = /^\s*\d+\s*\/\s*\d+/;

export type LengthFilterOptions = {
  /** When true (default), hard-drop X Articles marked on the card. */
  dropArticles?: boolean;
};

/** Parse X_MAX_THREAD_CHARS; invalid/empty → default 480. */
export function resolveMaxThreadChars(envValue?: string): number {
  const raw = (envValue ?? "").trim();
  if (!raw) return DEFAULT_MAX_THREAD_CHARS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_MAX_THREAD_CHARS;
  return n;
}

/** Prefer request override, then env, then default. */
export function resolveMaxThreadCharsFromFilters(
  override?: number,
  envValue?: string,
): number {
  if (typeof override === "number" && Number.isInteger(override) && override > 0) {
    return override;
  }
  return resolveMaxThreadChars(envValue);
}

export function isOversizedThread(text: string, maxChars: number): boolean {
  return text.length > maxChars;
}

/** Obvious multi-part openers like "1/17 Here's the thread". */
export function isThreadOpener(text: string): boolean {
  return THREAD_OPENER_RE.test(text) && /\bthread\b/i.test(text);
}

/**
 * True when the card is a same-account reply (self-thread mid-posts).
 * Either signal is enough (no fuzzy heuristics):
 * - `inReplyToScreenName` matches `author`, or
 * - reply-parent-derived `opAuthor` (via `hydrateReplyParents`) matches `author`.
 * Quote-derived `opAuthor` is not a self-reply signal.
 * Missing both → false.
 */
export function isSelfReply(thread: ThreadCard): boolean {
  const authorKey = normalizeAuthorKey(thread.author);
  if (!authorKey) return false;
  const replyToKey = normalizeAuthorKey(thread.inReplyToScreenName ?? "");
  if (replyToKey && replyToKey === authorKey) return true;
  if (!thread.opParentDerived) return false;
  const opKey = normalizeAuthorKey(thread.opAuthor ?? "");
  return Boolean(opKey && opKey === authorKey);
}

/** Hard-drop self-replies (pre- and/or post-hydrate). */
export function filterSelfReplies(threads: ThreadCard[]): {
  threads: ThreadCard[];
  selfReplyFilteredCount: number;
} {
  const kept: ThreadCard[] = [];
  let selfReplyFilteredCount = 0;
  for (const thread of threads) {
    if (isSelfReply(thread)) {
      selfReplyFilteredCount += 1;
      continue;
    }
    kept.push(thread);
  }
  return { threads: kept, selfReplyFilteredCount };
}

export function filterThreadsByLength(
  threads: ThreadCard[],
  maxChars: number = DEFAULT_MAX_THREAD_CHARS,
  opts: LengthFilterOptions = {},
): {
  threads: ThreadCard[];
  filteredCount: number;
  openerFilteredCount: number;
  articleFilteredCount: number;
} {
  const dropArticles = opts.dropArticles !== false;
  const kept: ThreadCard[] = [];
  let openerFilteredCount = 0;
  let articleFilteredCount = 0;
  let filteredCount = 0;

  for (const thread of threads) {
    if (dropArticles && thread.longform === "article") {
      filteredCount += 1;
      articleFilteredCount += 1;
      continue;
    }
    const opener = isThreadOpener(thread.text);
    const oversized = isOversizedThread(thread.text, maxChars);
    if (opener || oversized) {
      filteredCount += 1;
      if (opener) openerFilteredCount += 1;
      continue;
    }
    kept.push(thread);
  }

  return {
    threads: kept,
    filteredCount,
    openerFilteredCount,
    articleFilteredCount,
  };
}
