/**
 * Find the session user's reply to a curated parent tweet via SearchTimeline.
 */
import {
  searchTimelinePages,
  withSearchRecency,
  type SearchTimelineResult,
  type ThreadCard,
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

export type SearchTimelinePagesFn = (opts: {
  query: string;
  product?: "Latest" | "Top";
  count?: number;
  maxPages?: number;
  signal?: AbortSignal;
}) => Promise<SearchTimelineResult>;

/** Delays before each attempt (ms). */
export const DETECT_RETRY_DELAYS_MS = [0, 2000, 5000] as const;

export type DetectLogFn = (line: string) => void;

function normalizeScreenName(screenName: string): string {
  return screenName.trim().replace(/^@+/, "");
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
 * Latest search from the session user; keep exact in_reply_to matches.
 * Exactly one hit → reply; zero → none; many → ambiguous; search error → search_failed.
 */
export async function detectOwnReplyToThread(opts: {
  threadId: string;
  screenName: string;
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
  const query = withSearchRecency(`from:${screenName}`, within);
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
  const hits = result.threads.filter((t) => t.inReplyToId === threadId);
  const matchCount = hits.length;
  if (hits.length === 0) {
    return {
      ok: true,
      reply: null,
      reason: "none",
      rawCount,
      matchCount,
    };
  }
  if (hits.length > 1) {
    return {
      ok: true,
      reply: null,
      reason: "ambiguous",
      rawCount,
      matchCount,
    };
  }
  return {
    ok: true,
    reply: toDetected(hits[0]!),
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
 * Does not retry ambiguous. Honors AbortSignal between attempts.
 */
export async function detectOwnReplyToThreadWithRetry(opts: {
  threadId: string;
  screenName: string;
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
