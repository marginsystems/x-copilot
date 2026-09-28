/**
 * Official X API v2 tweet lookup (parent OP hydrate + engagement metrics).
 */
import { objectValue, isRecord } from "../platform/unknownValue.js";
import { isV2Tweet, isV2User } from "./xPayload.js";
import { normalizeAuthorKey } from "../desk/interactionCooldown.js";
import { xApiGet } from "./xApi.js";
import { getXApiCredsFromEnv, type XApiCreds } from "./xApi.js";
import { MAX_OP_TEXT_CHARS, type ThreadCard } from "../scout/threadCard.js";
import { tweetResultToCard } from "./xGraphqlParse.js";
import { v2TweetToCard } from "./xV2Card.js";
import {
  LIVE_METRICS_TTL_MS,
  clearLiveMetricsRowsForTests,
  readLiveMetricsRows,
  writeLiveMetricsRows,
  type LiveMetricsRow,
} from "./liveMetricsStore.js";

const parentCache = new Map<string, ParentTweet | null>();

export type ParentTweet = {
  author: string;
  text: string;
  createdAt?: string;
  longform?: "note_tweet" | "article";
  hasOutboundLink?: boolean;
  hasNativeMedia?: boolean;
  views?: number;
};

function parentFromCard(card: {
  author: string;
  text: string;
  createdAt?: string;
  longform?: "note_tweet" | "article";
  hasOutboundLink?: boolean;
  mediaShortlinks?: string[];
  hasNativeMedia?: boolean;
  opHasNativeMedia?: boolean;
  views?: number;
}): ParentTweet {
  return {
    author: card.author,
    text: card.text,
    ...(card.createdAt ? { createdAt: card.createdAt } : {}),
    ...(card.longform ? { longform: card.longform } : {}),
    ...(card.hasOutboundLink ? { hasOutboundLink: true } : {}),
    ...(card.mediaShortlinks?.length || card.hasNativeMedia || card.opHasNativeMedia
      ? { hasNativeMedia: true }
      : {}),
    ...(typeof card.views === "number" ? { views: card.views } : {}),
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
    ...(parent.createdAt ? { opCreatedAt: parent.createdAt } : {}),
    opParentDerived: true,
    opCharCount: parent.text.length,
    ...(parent.createdAt ? { opCreatedAt: parent.createdAt } : {}),
    ...(parent.longform ? { opLongform: parent.longform } : {}),
    ...(parent.hasOutboundLink || card.hasOutboundLink
      ? { hasOutboundLink: true }
      : {}),
    ...(parent.hasNativeMedia ? { opHasNativeMedia: true } : {}),
    opViews: parent.views,
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
  const payload = objectValue(objectValue(data).data);
  return objectValue(payload.tweetResult).result ?? objectValue(payload.tweet_result).result;
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
  const maybeV2 = objectValue(data);
  const rawMetrics = objectValue(maybeV2.data).public_metrics ?? maybeV2.public_metrics;
  const v2Metrics = isRecord(rawMetrics) ? rawMetrics : null;
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
    node = objectValue(maybeWrapped);
  } else {
    node = objectValue(data);
  }
  if (node.tweet && typeof node.tweet === "object") {
    node = objectValue(node.tweet);
  }

  const viewsObj = objectValue(node.views);
  const views = asFiniteNumber(viewsObj?.count);
  const legacy = objectValue(node.legacy);
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

function parentFromV2(json: unknown): ParentTweet | null {
  const root = objectValue(json);
  const tw = root.data;
  if (!isV2Tweet(tw) || !tw.id) return null;
  const includes = objectValue(root.includes);
  const users = Array.isArray(includes.users) ? includes.users.filter(isV2User) : [];
  const media = Array.isArray(includes.media) ? includes.media.map(objectValue) : [];
  const usersById = new Map(
    users
      .filter((u) => u.id)
      .map((u) => [u.id!, u] as const),
  );
  const mediaKeys = new Set(
    media
      .map((m) => m.media_key)
      .filter((key): key is string => typeof key === "string"),
  );
  const card = v2TweetToCard(tw, usersById, new Map(), mediaKeys);
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
      "tweet.fields":
        "created_at,author_id,note_tweet,entities,attachments,article,card_uri,public_metrics",
      expansions: "author_id,attachments.media_keys",
      "media.fields": "media_key,type,url,preview_image_url",
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
  const envelope = objectValue(res.json);
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
    const id = String(objectValue(row).id ?? "").trim();
    if (!id) continue;
    const metrics = parseTweetMetrics(row);
    if (metrics) out.set(id, metrics);
  }
  return out;
}

/** How long a batch live-metrics result stays cached before a re-fetch. */

export const LIVE_METRICS_WAIT_BUDGET_MS = 1500;

export const LIVE_METRICS_FAILURE_TTL_MS = 60 * 1000;

const liveMetricsCache = new Map<
  string,
  { metrics: TweetMetrics | null; at: number }
>();

const liveMetricsFailedAt = new Map<string, number>();

type LiveMetricsLookup = {
  promise: Promise<Map<string, TweetMetrics>>;
  controller: AbortController;
  waiters: number;
};

const liveMetricsInflight = new Map<string, LiveMetricsLookup>();

export function forgetLiveMetricsMemoryForTests(): void {
  liveMetricsCache.clear();
  liveMetricsFailedAt.clear();
  liveMetricsInflight.clear();
}

export function clearLiveMetricsCacheForTests(): void {
  forgetLiveMetricsMemoryForTests();
  clearLiveMetricsRowsForTests();
}

function restoreLiveMetricsFromStore(
  ids: string[],
  now: number,
  out: Map<string, TweetMetrics>,
): string[] {
  const restored = new Set<string>();
  for (const row of readLiveMetricsRows(ids, now - LIVE_METRICS_TTL_MS)) {
    const age = now - row.fetchedAt;
    if (row.status === "failed") {
      if (age >= LIVE_METRICS_FAILURE_TTL_MS) continue;
      liveMetricsFailedAt.set(row.tweetId, row.fetchedAt);
    } else {
      if (age >= LIVE_METRICS_TTL_MS) continue;
      liveMetricsCache.set(row.tweetId, { metrics: row.metrics, at: row.fetchedAt });
      if (row.metrics) out.set(row.tweetId, row.metrics);
    }
    restored.add(row.tweetId);
  }
  return restored.size ? ids.filter((id) => !restored.has(id)) : ids;
}

function logLiveMetricsLookup(
  outcome: string,
  idCount: number,
  durationMs: number,
): void {
  console.warn(
    `[live-metrics] lookup ${outcome} ids=${idCount} durationMs=${durationMs}`,
  );
}

async function runLiveMetricsLookup(
  ids: string[],
  session: XApiCreds,
  signal: AbortSignal,
): Promise<Map<string, TweetMetrics>> {
  const startedAt = Date.now();
  const res = await xApiGet({
    path: "/tweets",
    query: {
      ids: ids.join(","),
      "tweet.fields": "public_metrics",
    },
    creds: session,
    signal,
    timeoutMs: 12000,
    skipUsage: true,
  });
  const finishedAt = Date.now();
  const durationMs = finishedAt - startedAt;
  if (!res.ok) {
    if (res.error === "client_disconnected") return new Map();
    for (const id of ids) liveMetricsFailedAt.set(id, finishedAt);
    writeLiveMetricsRows(
      ids.map((tweetId) => ({ tweetId, status: "failed", metrics: null, fetchedAt: finishedAt })),
    );
    logLiveMetricsLookup(res.error, ids.length, durationMs);
    return new Map();
  }
  if (durationMs > LIVE_METRICS_WAIT_BUDGET_MS) {
    logLiveMetricsLookup("slow", ids.length, durationMs);
  }

  const fetched = parseTweetsMetricsMap(res.json);
  const rows: LiveMetricsRow[] = [];
  for (const [id, metrics] of fetched) {
    liveMetricsCache.set(id, { metrics, at: finishedAt });
    rows.push({ tweetId: id, status: "ok", metrics, fetchedAt: finishedAt });
  }
  // Cache confirmed absence (deleted/private tweets left out of the batch) so
  // ids that can never resolve stop being re-fetched on every stats request.
  for (const id of ids) {
    liveMetricsFailedAt.delete(id);
    if (fetched.has(id)) continue;
    liveMetricsCache.set(id, { metrics: null, at: finishedAt });
    rows.push({ tweetId: id, status: "absent", metrics: null, fetchedAt: finishedAt });
  }
  writeLiveMetricsRows(rows);
  return fetched;
}

function joinLiveMetricsLookup(
  ids: string[],
  session: XApiCreds,
): LiveMetricsLookup {
  const key = [...ids].sort().join(",");
  const existing = liveMetricsInflight.get(key);
  if (existing && !existing.controller.signal.aborted) return existing;
  const controller = new AbortController();
  const lookup: LiveMetricsLookup = {
    promise: runLiveMetricsLookup(ids, session, controller.signal).finally(() => {
      if (liveMetricsInflight.get(key) === lookup) liveMetricsInflight.delete(key);
    }),
    controller,
    waiters: 0,
  };
  liveMetricsInflight.set(key, lookup);
  return lookup;
}

function awaitLiveMetricsLookup(
  lookup: LiveMetricsLookup,
  signal: AbortSignal | undefined,
  waitMs: number | undefined,
): Promise<Map<string, TweetMetrics>> {
  return new Promise((resolve) => {
    const timer =
      waitMs === undefined ? undefined : setTimeout(() => resolve(new Map()), waitMs);
    const onAbort = () => {
      clearTimeout(timer);
      lookup.waiters -= 1;
      if (lookup.waiters <= 0) lookup.controller.abort();
      resolve(new Map());
    };
    const settle = (fetched: Map<string, TweetMetrics>) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(fetched);
    };
    lookup.waiters += 1;
    signal?.addEventListener("abort", onAbort, { once: true });
    lookup.promise.then(settle, () => settle(new Map()));
  });
}

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
  waitMs?: number;
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
    const failedAt = liveMetricsFailedAt.get(id);
    if (failedAt !== undefined && now - failedAt < LIVE_METRICS_FAILURE_TTL_MS) continue;
    toFetch.push(id);
  }
  if (!toFetch.length) return out;
  for (const [id, entry] of liveMetricsCache) {
    if (now - entry.at >= LIVE_METRICS_TTL_MS) liveMetricsCache.delete(id);
  }
  for (const [id, failedAt] of liveMetricsFailedAt) {
    if (now - failedAt >= LIVE_METRICS_FAILURE_TTL_MS) liveMetricsFailedAt.delete(id);
  }

  const session = opts.session ?? getXApiCredsFromEnv();
  if (!session.configured) return out;

  const pending = restoreLiveMetricsFromStore(toFetch, now, out);
  if (!pending.length) return out;

  const fetched = await awaitLiveMetricsLookup(
    joinLiveMetricsLookup(pending, session),
    opts.signal,
    opts.waitMs,
  );
  for (const [id, metrics] of fetched) out.set(id, metrics);
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
      source =
        root && normalizeAuthorKey(root.author) !== normalizeAuthorKey(t.author)
          ? root
          : null;
    }
    if (!source) {
      unhydratedReplyCount += 1;
      continue;
    }
    out[i] = applyHydratedParent(t, source);
  }
  return { threads: out, unhydratedReplyCount };
}
