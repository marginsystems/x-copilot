/**
 * Official X API v2 tweet lookup (parent OP hydrate + engagement metrics).
 */
import { normalizeAuthorKey } from "./interactionCooldown.js";
import { xApiGet } from "./xApi.js";
import { getXApiCredsFromEnv, type XApiCreds } from "./xApi.js";
import { MAX_OP_TEXT_CHARS, type ThreadCard } from "./threadCard.js";
import { tweetResultToCard } from "./xGraphqlParse.js";
import { v2TweetToCard } from "./xV2Card.js";

const parentCache = new Map<string, ParentTweet | null>();

export type ParentTweet = {
  author: string;
  text: string;
  longform?: "note_tweet" | "article";
};

function parentFromCard(card: {
  author: string;
  text: string;
  longform?: "note_tweet" | "article";
}): ParentTweet {
  return {
    author: card.author,
    text: card.text,
    ...(card.longform ? { longform: card.longform } : {}),
  };
}

function applyHydratedParent(
  card: ThreadCard,
  parent: ParentTweet,
): ThreadCard {
  return {
    ...card,
    opAuthor: parent.author,
    opText: parent.text.slice(0, MAX_OP_TEXT_CHARS),
    opParentDerived: true,
    opCharCount: parent.text.length,
    ...(parent.longform ? { opLongform: parent.longform } : {}),
  };
}

export type TweetMetrics = {
  views?: number;
  likes?: number;
  replies?: number;
  retweets?: number;
  bookmarks?: number;
};

/** @deprecated GraphQL query-id helper — unused on v2. */
export function getTweetResultQueryId(): string {
  return "v2/tweets";
}

/** Test helper — clear in-process parent cache. */
export function clearParentTweetCache(): void {
  parentCache.clear();
}

function tweetResultFromPayload(data: unknown): unknown {
  const root = data as {
    data?: {
      tweetResult?: { result?: unknown };
      tweet_result?: { result?: unknown };
    };
  };
  return root?.data?.tweetResult?.result ?? root?.data?.tweet_result?.result;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Parse engagement counts from a TweetResultByRestId payload or tweet result node.
 * Soft-fails to null when no usable counts are present.
 * (Kept for unit-test fixtures of legacy GraphQL shapes.)
 */
export function parseTweetMetrics(data: unknown): TweetMetrics | null {
  if (!data || typeof data !== "object") return null;

  // v2 tweet object
  const maybeV2 = data as {
    data?: {
      public_metrics?: Record<string, unknown>;
      id?: string;
    };
    public_metrics?: Record<string, unknown>;
  };
  const v2Metrics =
    maybeV2.data?.public_metrics ??
    (maybeV2.public_metrics && typeof maybeV2.public_metrics === "object"
      ? maybeV2.public_metrics
      : null);
  if (v2Metrics) {
    const likes = asFiniteNumber(v2Metrics.like_count);
    const replies = asFiniteNumber(v2Metrics.reply_count);
    const retweets = asFiniteNumber(v2Metrics.retweet_count);
    const views = asFiniteNumber(v2Metrics.impression_count);
    const bookmarks = asFiniteNumber(v2Metrics.bookmark_count);
    if (
      views === undefined &&
      likes === undefined &&
      replies === undefined &&
      retweets === undefined &&
      bookmarks === undefined
    ) {
      return null;
    }
    const out: TweetMetrics = {};
    if (views !== undefined) out.views = views;
    if (likes !== undefined) out.likes = likes;
    if (replies !== undefined) out.replies = replies;
    if (retweets !== undefined) out.retweets = retweets;
    if (bookmarks !== undefined) out.bookmarks = bookmarks;
    return out;
  }

  const maybeWrapped = tweetResultFromPayload(data);
  let node: Record<string, unknown> | null = null;
  if (maybeWrapped && typeof maybeWrapped === "object") {
    node = maybeWrapped as Record<string, unknown>;
  } else {
    node = data as Record<string, unknown>;
  }
  if (node.tweet && typeof node.tweet === "object") {
    node = node.tweet as Record<string, unknown>;
  }

  const viewsObj = node.views as { count?: unknown } | undefined;
  const views = asFiniteNumber(viewsObj?.count);
  const legacy = (node.legacy ?? {}) as Record<string, unknown>;
  const likes = asFiniteNumber(legacy.favorite_count);
  const replies = asFiniteNumber(legacy.reply_count);
  const retweets = asFiniteNumber(legacy.retweet_count);

  if (
    views === undefined &&
    likes === undefined &&
    replies === undefined &&
    retweets === undefined
  ) {
    return null;
  }
  const out: TweetMetrics = {};
  if (views !== undefined) out.views = views;
  if (likes !== undefined) out.likes = likes;
  if (replies !== undefined) out.replies = replies;
  if (retweets !== undefined) out.retweets = retweets;
  return out;
}

function parseTweetResultPayload(data: unknown): ParentTweet | null {
  const result = tweetResultFromPayload(data);
  const card = tweetResultToCard(result);
  if (!card?.author || !card.text) return null;
  return parentFromCard(card);
}

type V2LookupJson = {
  data?: {
    id?: string;
    text?: string;
    author_id?: string;
    note_tweet?: { text?: string };
    article?: unknown;
    entities?: {
      urls?: Array<{
        url?: string;
        expanded_url?: string;
        display_url?: string;
      }>;
    };
    public_metrics?: Record<string, unknown>;
  };
  includes?: {
    users?: Array<{ id?: string; username?: string; name?: string }>;
  };
};

function parentFromV2(json: unknown): ParentTweet | null {
  const root = json as V2LookupJson;
  const tw = root.data;
  if (!tw?.id) return null;
  const usersById = new Map(
    (root.includes?.users ?? [])
      .filter((u) => u.id)
      .map((u) => [u.id!, u] as const),
  );
  const card = v2TweetToCard(tw, usersById);
  if (!card?.author || !card.text) return null;
  return parentFromCard(card);
}

/**
 * Fetch parent/OP tweet text by rest id. Soft-fails to null.
 * Cached per process for successes and genuine misses.
 */
export async function fetchParentTweet(opts: {
  tweetId: string;
  session?: XApiCreds;
  signal?: AbortSignal;
}): Promise<ParentTweet | null> {
  const tweetId = opts.tweetId.trim();
  if (!tweetId) return null;
  if (opts.signal?.aborted) return null;
  if (parentCache.has(tweetId)) return parentCache.get(tweetId) ?? null;

  const session = opts.session ?? getXApiCredsFromEnv();
  if (!session.configured) {
    parentCache.set(tweetId, null);
    return null;
  }

  const res = await xApiGet({
    path: `/tweets/${encodeURIComponent(tweetId)}`,
    query: {
      "tweet.fields": "created_at,author_id,note_tweet,entities,article",
      expansions: "author_id",
      "user.fields": "username,name",
    },
    creds: session,
    signal: opts.signal,
    timeoutMs: 12000,
  });

  if (!res.ok) {
    if (res.status === 404) parentCache.set(tweetId, null);
    return null;
  }

  // Prefer v2 mapping; fall back to legacy GraphQL fixture parser for tests.
  const parent = parentFromV2(res.json) ?? parseTweetResultPayload(res.json);
  if (parent) {
    parentCache.set(tweetId, parent);
    return parent;
  }
  // Only cache a genuine miss (no tweet data in the payload). A 200 whose
  // data maps to no parent (e.g. suspended author missing from includes.users)
  // stays uncached so a later run can retry instead of poisoning the cache.
  const envelope = res.json as { data?: unknown } | null;
  if (envelope?.data === undefined || envelope.data === null) {
    parentCache.set(tweetId, null);
  }
  return null;
}

/**
 * Fetch engagement metrics for a tweet by rest id. Soft-fails to null.
 */
export async function fetchTweetMetrics(opts: {
  tweetId: string;
  session?: XApiCreds;
  signal?: AbortSignal;
  skipUsage?: boolean;
}): Promise<TweetMetrics | null> {
  const tweetId = opts.tweetId.trim();
  if (!tweetId) return null;
  if (opts.signal?.aborted) return null;

  const session = opts.session ?? getXApiCredsFromEnv();
  if (!session.configured) {
    return null;
  }

  const res = await xApiGet({
    path: `/tweets/${encodeURIComponent(tweetId)}`,
    query: {
      "tweet.fields": "public_metrics",
    },
    creds: session,
    signal: opts.signal,
    timeoutMs: 12000,
    skipUsage: opts.skipUsage,
  });
  if (!res.ok) return null;
  return parseTweetMetrics(res.json);
}

/** Parse `GET /2/tweets?ids=` payload → id → metrics. */
export function parseTweetsMetricsMap(json: unknown): Map<string, TweetMetrics> {
  const out = new Map<string, TweetMetrics>();
  if (!json || typeof json !== "object") return out;
  const data = (json as { data?: unknown }).data;
  const rows = Array.isArray(data) ? data : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = String((row as { id?: unknown }).id ?? "").trim();
    if (!id) continue;
    const metrics = parseTweetMetrics(row);
    if (metrics) out.set(id, metrics);
  }
  return out;
}

/** How long a batch live-metrics result stays cached before a re-fetch. */
const LIVE_METRICS_TTL_MS = 15 * 60 * 1000;

const liveMetricsCache = new Map<
  string,
  { metrics: TweetMetrics | null; at: number }
>();

/**
 * One request for many tweet ids (X cap 100). Soft-fails to an empty map.
 * Cached per id (short TTL) so chart refreshes do not re-fetch the same
 * still-pending replies on every request, and never billed to the requesting
 * tenant's credit pool (passive reads, unlike Scout's active lookups).
 */
export async function fetchTweetMetricsMany(opts: {
  tweetIds: string[];
  session?: XApiCreds;
  signal?: AbortSignal;
}): Promise<Map<string, TweetMetrics>> {
  const ids = [...new Set(opts.tweetIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  if (opts.signal?.aborted) return new Map();

  const now = Date.now();
  const out = new Map<string, TweetMetrics>();
  const toFetch: string[] = [];
  for (const id of ids) {
    const cached = liveMetricsCache.get(id);
    if (cached && now - cached.at < LIVE_METRICS_TTL_MS) {
      if (cached.metrics) out.set(id, cached.metrics);
      continue;
    }
    toFetch.push(id);
  }
  if (!toFetch.length) return out;
  for (const [id, entry] of liveMetricsCache) {
    if (now - entry.at >= LIVE_METRICS_TTL_MS) liveMetricsCache.delete(id);
  }

  const session = opts.session ?? getXApiCredsFromEnv();
  if (!session.configured) return out;

  const res = await xApiGet({
    path: "/tweets",
    query: {
      ids: toFetch.join(","),
      "tweet.fields": "public_metrics",
    },
    creds: session,
    signal: opts.signal,
    timeoutMs: 12000,
    skipUsage: true,
  });
  if (!res.ok) return out;

  const fetched = parseTweetsMetricsMap(res.json);
  const fetchedAt = Date.now();
  for (const [id, metrics] of fetched) {
    liveMetricsCache.set(id, { metrics, at: fetchedAt });
    out.set(id, metrics);
  }
  // Cache confirmed absence (deleted/private tweets left out of the batch) so
  // ids that can never resolve stop being re-fetched on every stats request.
  for (const id of toFetch) {
    if (!out.has(id)) liveMetricsCache.set(id, { metrics: null, at: fetchedAt });
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type HydrateReplyParentsResult = {
  threads: ThreadCard[];
  /** Reply cards whose parent lookup failed (self-reply leak visibility). */
  unhydratedReplyCount: number;
};

/**
 * Fill opAuthor/opText on reply cards missing OP text (before triage).
 */
export async function hydrateReplyParents(opts: {
  threads: ThreadCard[];
  session?: XApiCreds;
  signal?: AbortSignal;
  delayMs?: number;
  fetchParent?: typeof fetchParentTweet;
}): Promise<HydrateReplyParentsResult> {
  const fetchParent = opts.fetchParent ?? fetchParentTweet;
  const delayMs = opts.delayMs ?? 400;
  const out = [...opts.threads];
  let lookedUp = 0;
  let unhydratedReplyCount = 0;

  for (let i = 0; i < out.length; i++) {
    if (opts.signal?.aborted) break;
    const t = out[i]!;
    if (!t.inReplyToId || t.opParentDerived) continue;
    if (lookedUp > 0) await sleep(delayMs);
    lookedUp += 1;
    const parent = await fetchParent({
      tweetId: t.inReplyToId,
      session: opts.session,
      signal: opts.signal,
    });
    if (
      parent &&
      normalizeAuthorKey(parent.author) === normalizeAuthorKey(t.author)
    ) {
      out[i] = applyHydratedParent(t, parent);
      continue;
    }
    let source = parent;
    if (t.conversationId && t.conversationId !== t.inReplyToId) {
      if (lookedUp > 0) await sleep(delayMs);
      lookedUp += 1;
      const root = await fetchParent({
        tweetId: t.conversationId,
        session: opts.session,
        signal: opts.signal,
      });
      if (
        root &&
        normalizeAuthorKey(root.author) !== normalizeAuthorKey(t.author)
      ) {
        source = root;
      }
    }
    if (!source) {
      unhydratedReplyCount += 1;
      continue;
    }
    out[i] = applyHydratedParent(t, source);
  }
  return { threads: out, unhydratedReplyCount };
}
