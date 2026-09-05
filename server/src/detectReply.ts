/**
 * Find the operator's reply in a curated conversation via official recent search.
 */
import type { ThreadCard } from "./threadCard.js";
import type { Interaction } from "./interactionStore.js";
import {
  searchTimelinePages,
  withSearchRecency,
  type SearchTimelineResult,
} from "./xSearch.js";

export type DetectedReply = {
  replyId: string;
  replyUrl: string;
  replyText: string;
  createdAt?: string;
};

export type DetectReplyReason = "none" | "ambiguous" | "search_failed";

export type DetectReplyResult =
  | {
      ok: true;
      reply: DetectedReply;
      rawCount: number;
      matchCount: number;
    }
  | {
      ok: true;
      reply: null;
      reason: DetectReplyReason;
      rawCount: number;
      matchCount: number;
    };

export function findRecentInteractionReply(opts: {
  history: Interaction[];
  threadId: string;
  conversationId?: string;
  nowMs?: number;
}): DetectedReply | null {
  const requestedIds = new Set(
    [opts.threadId, opts.conversationId]
      .map((id) => id?.trim())
      .filter((id): id is string => Boolean(id)),
  );
  const nowMs = opts.nowMs ?? Date.now();
  const cutoffMs = nowMs - 60 * 60 * 1000;

  for (const row of opts.history) {
    const matches = [row.threadId, row.inReplyToId, row.conversationId].some(
      (id) => Boolean(id?.trim() && requestedIds.has(id.trim())),
    );
    const recent = [row.at, row.postedAt].some((value) => {
      const atMs = value ? Date.parse(value) : NaN;
      return Number.isFinite(atMs) && atMs >= cutoffMs && atMs <= nowMs;
    });
    if (!matches || !recent) continue;
    const replyUrl =
      row.replyUrl?.trim() ||
      (row.replyId?.trim()
        ? `https://x.com/i/status/${row.replyId.trim()}`
        : "");
    if (!replyUrl) continue;
    return {
      replyId: row.replyId?.trim() || replyUrl.split("/").pop() || "",
      replyUrl,
      replyText: row.text ?? "",
      ...(row.postedAt ? { createdAt: row.postedAt } : {}),
    };
  }
  return null;
}

export type SearchTimelinePagesFn = (opts: {
  query: string;
  product?: "Latest" | "Top";
  count?: number;
  maxPages?: number;
  signal?: AbortSignal;
}) => Promise<SearchTimelineResult>;

/** Delays before each attempt (ms). */
export const DETECT_RETRY_DELAYS_MS = [0, 2000, 5000] as const;

import { parseXHandle } from "./xHandle.js";

export type DetectLogFn = (line: string) => void;

export function resolveDetectScreenName(
  userHandle: string | null | undefined,
): string | null {
  return parseXHandle(userHandle ?? "");
}

function normalizeScreenName(screenName: string): string {
  return parseXHandle(screenName) ?? screenName.trim().replace(/^@+/, "");
}

function toDetected(card: ThreadCard): DetectedReply {
  const out: DetectedReply = {
    replyId: card.id,
    replyUrl: card.url,
    replyText: card.text,
  };
  if (card.createdAt) out.createdAt = card.createdAt;
  return out;
}

function sleep(
  ms: number,
  signal?: AbortSignal,
): Promise<"ok" | "aborted"> {
  if (ms <= 0) return Promise.resolve(signal?.aborted ? "aborted" : "ok");
  if (signal?.aborted) return Promise.resolve("aborted");
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(signal?.aborted ? "aborted" : "ok");
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve("aborted");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Narrow recent-search query: our replies in this conversation only.
 * conversation_id matches the conversation ROOT, so prefer the card's
 * conversationId and fall back to the card id when unknown.
 */
export function buildDetectOwnReplyQuery(
  screenName: string,
  threadId: string,
  withinTime = "24h",
  conversationId?: string,
): string {
  const name = normalizeScreenName(screenName);
  const id = conversationId?.trim() || threadId.trim();
  return withSearchRecency(
    `conversation_id:${id} from:${name} is:reply`,
    withinTime,
  );
}

const TWITTER_SNOWFLAKE_EPOCH_MS = 1288834974657;

function replyRecency(card: ThreadCard): number {
  const created = card.createdAt ? Date.parse(card.createdAt) : NaN;
  if (Number.isFinite(created)) return created;
  try {
    return Number(BigInt(card.id) >> 22n) + TWITTER_SNOWFLAKE_EPOCH_MS;
  } catch {
    return 0;
  }
}

function newestReply(cards: ThreadCard[]): ThreadCard {
  return cards.reduce((best, card) =>
    replyRecency(card) > replyRecency(best) ? card : best,
  );
}

/**
 * Prefer a reply to the curated card. Otherwise any own-reply in this
 * conversation counts (OP or another tweet). Several hits → newest.
 */
export function pickOwnReplyInConversation(
  threads: ThreadCard[],
  threadId: string,
): ThreadCard | null {
  if (threads.length === 0) return null;
  const exact = threads.filter((t) => t.inReplyToId === threadId);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return newestReply(exact);
  if (threads.length === 1) return threads[0]!;
  return newestReply(threads);
}

/**
 * Latest search from the operator in this conversation. A reply to the
 * card, the OP, or anyone else in the thread qualifies. Search error →
 * search_failed. Empty → none.
 */
export async function detectOwnReplyToThread(opts: {
  threadId: string;
  screenName: string;
  /** Conversation root id; falls back to threadId when absent. */
  conversationId?: string;
  withinTime?: string;
  maxPages?: number;
  count?: number;
  signal?: AbortSignal;
  searchTimelinePages?: SearchTimelinePagesFn;
}): Promise<DetectReplyResult> {
  const threadId = opts.threadId.trim();
  const screenName = normalizeScreenName(opts.screenName);
  if (!threadId || !screenName) {
    return {
      ok: true,
      reply: null,
      reason: "search_failed",
      rawCount: 0,
      matchCount: 0,
    };
  }

  const within = opts.withinTime ?? "24h";
  const query = buildDetectOwnReplyQuery(
    screenName,
    threadId,
    within,
    opts.conversationId,
  );
  const search = opts.searchTimelinePages ?? searchTimelinePages;

  let result: SearchTimelineResult;
  try {
    result = await search({
      query,
      product: "Latest",
      count: opts.count ?? 20,
      maxPages: opts.maxPages ?? 1,
      signal: opts.signal,
    });
  } catch {
    return {
      ok: true,
      reply: null,
      reason: "search_failed",
      rawCount: 0,
      matchCount: 0,
    };
  }

  if (!result.ok) {
    return {
      ok: true,
      reply: null,
      reason: "search_failed",
      rawCount: 0,
      matchCount: 0,
    };
  }

  const rawCount = result.threads.length;
  const chosen = pickOwnReplyInConversation(result.threads, threadId);
  const matchCount = chosen ? 1 : 0;
  if (!chosen) {
    return {
      ok: true,
      reply: null,
      reason: "none",
      rawCount,
      matchCount,
    };
  }
  return {
    ok: true,
    reply: toDetected(chosen),
    rawCount,
    matchCount,
  };
}

function reasonLabel(result: DetectReplyResult): string {
  if (result.reply) return "found";
  return result.reason;
}

function shouldRetry(result: DetectReplyResult): boolean {
  if (result.reply) return false;
  return result.reason === "none" || result.reason === "search_failed";
}

/**
 * Retry soft misses (none / search_failed) with backoff for SearchTimeline index lag.
 * Does not retry a found hit. Honors AbortSignal between attempts.
 */
export async function detectOwnReplyToThreadWithRetry(opts: {
  threadId: string;
  screenName: string;
  /** Conversation root id; falls back to threadId when absent. */
  conversationId?: string;
  withinTime?: string;
  maxPages?: number;
  count?: number;
  signal?: AbortSignal;
  searchTimelinePages?: SearchTimelinePagesFn;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<"ok" | "aborted">;
  log?: DetectLogFn;
  delaysMs?: readonly number[];
}): Promise<DetectReplyResult> {
  const delays = opts.delaysMs ?? DETECT_RETRY_DELAYS_MS;
  const doSleep = opts.sleep ?? sleep;
  const log = opts.log ?? ((line: string) => console.info(line));
  const total = delays.length;

  let last: DetectReplyResult = {
    ok: true,
    reply: null,
    reason: "search_failed",
    rawCount: 0,
    matchCount: 0,
  };

  for (let i = 0; i < total; i++) {
    const delay = delays[i] ?? 0;
    if (delay > 0) {
      const waited = await doSleep(delay, opts.signal);
      if (waited === "aborted" || opts.signal?.aborted) {
        return last;
      }
    } else if (opts.signal?.aborted) {
      return {
        ok: true,
        reply: null,
        reason: "search_failed",
        rawCount: 0,
        matchCount: 0,
      };
    }

    last = await detectOwnReplyToThread({
      threadId: opts.threadId,
      screenName: opts.screenName,
      conversationId: opts.conversationId,
      withinTime: opts.withinTime,
      maxPages: opts.maxPages,
      count: opts.count,
      signal: opts.signal,
      searchTimelinePages: opts.searchTimelinePages,
    });

    const reason = reasonLabel(last);
    log(
      `[detect-reply] threadId=${opts.threadId.trim()} attempt=${i + 1}/${total} reason=${reason} rawCount=${last.rawCount} matchCount=${last.matchCount}`,
    );

    if (!shouldRetry(last)) {
      return last;
    }
  }

  return last;
}
