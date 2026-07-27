/**
 * Deterministic post-search filters (length / thread openers / Articles) before triage.
 */
import type { ThreadCard } from "./xSearch.js";

export const DEFAULT_MAX_THREAD_CHARS = 480;

const THREAD_OPENER_RE = /^\s*\d+\s*\/\s*\d+/;

/** Parse X_MAX_THREAD_CHARS; invalid/empty → default 480. */
export function resolveMaxThreadChars(envValue?: string): number {
  const raw = (envValue ?? "").trim();
  if (!raw) return DEFAULT_MAX_THREAD_CHARS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_MAX_THREAD_CHARS;
  return n;
}

export function isOversizedThread(text: string, maxChars: number): boolean {
  return text.length > maxChars;
}

/** Obvious multi-part openers like "1/17 Here's the thread". */
export function isThreadOpener(text: string): boolean {
  return THREAD_OPENER_RE.test(text) && /\bthread\b/i.test(text);
}

export function filterThreadsByLength(
  threads: ThreadCard[],
  maxChars: number = DEFAULT_MAX_THREAD_CHARS,
): {
  threads: ThreadCard[];
  filteredCount: number;
  openerFilteredCount: number;
  articleFilteredCount: number;
} {
  const kept: ThreadCard[] = [];
  let openerFilteredCount = 0;
  let articleFilteredCount = 0;
  let filteredCount = 0;

  for (const thread of threads) {
    if (thread.longform === "article") {
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
