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
  | { ok: true; reply: DetectedReply }
  | { ok: true; reply: null; reason: DetectReplyReason };

export type SearchTimelinePagesFn = (opts: {
  query: string;
  product?: "Latest" | "Top";
  count?: number;
  maxPages?: number;
  signal?: AbortSignal;
}) => Promise<SearchTimelineResult>;

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
  if (!threadId || !screenName || screenName.toLowerCase() === "unknown") {
    return { ok: true, reply: null, reason: "search_failed" };
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
    return { ok: true, reply: null, reason: "search_failed" };
  }

  if (!result.ok) {
    return { ok: true, reply: null, reason: "search_failed" };
  }

  const hits = result.threads.filter((t) => t.inReplyToId === threadId);
  if (hits.length === 0) {
    return { ok: true, reply: null, reason: "none" };
  }
  if (hits.length > 1) {
    return { ok: true, reply: null, reason: "ambiguous" };
  }
  return { ok: true, reply: toDetected(hits[0]!) };
}
