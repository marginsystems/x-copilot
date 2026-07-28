/**
 * Session-backed lookup of a single tweet by rest id (parent OP hydrate).
 */
import {
  buildSessionHeaders,
  getSessionFromEnv,
  type SessionCreds,
} from "./xSession.js";
import { searchFeatures, tweetResultToCard } from "./xSearch.js";

const DEFAULT_TWEET_RESULT_QUERY_IDS = [
  "0hWvDhmW8Y3-o0KUQA5tAA",
  "VWFGPVAGkZMGRKGe3GFSbw",
  "sCUGcvxAswEHExgYEilL9g",
];

let cachedTweetQueryId: string | null = null;
const parentCache = new Map<string, { author: string; text: string } | null>();

export type ParentTweet = { author: string; text: string };

export type TweetMetrics = {
  views?: number;
  likes?: number;
  replies?: number;
  retweets?: number;
};

export function getTweetResultQueryId(): string {
  return (
    process.env.X_TWEET_RESULT_QUERY_ID?.trim() ||
    cachedTweetQueryId ||
    DEFAULT_TWEET_RESULT_QUERY_IDS[0]
  );
}

/** Test helper — clear in-process parent cache. */
export function clearParentTweetCache(): void {
  parentCache.clear();
}

const metricsCache = new Map<string, TweetMetrics | null>();

/** Test helper — clear in-process metrics cache. */
export function clearTweetMetricsCache(): void {
  metricsCache.clear();
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

function parseTweetResultPayload(data: unknown): ParentTweet | null {
  const result = tweetResultFromPayload(data);
  const card = tweetResultToCard(result);
  if (!card?.author || !card.text) return null;
  return { author: card.author, text: card.text };
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
 */
export function parseTweetMetrics(data: unknown): TweetMetrics | null {
  if (!data || typeof data !== "object") return null;
  const maybeWrapped = tweetResultFromPayload(data);
  let node: Record<string, unknown> | null = null;
  if (maybeWrapped && typeof maybeWrapped === "object") {
    node = maybeWrapped as Record<string, unknown>;
  } else {
    node = data as Record<string, unknown>;
  }
  // Unwrap TweetWithVisibilityResults etc.
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

async function healTweetResultQueryId(
  session: SessionCreds,
): Promise<string | null> {
  try {
    const headers = buildSessionHeaders(session);
    const page = await fetch("https://x.com/home", {
      headers: { "user-agent": headers["user-agent"] },
    });
    const html = await page.text();
    const scripts = [
      ...html.matchAll(
        /https:\/\/abs\.twimg\.com\/responsive-web\/client-web[^"']+\.js/g,
      ),
    ].map((m) => m[0]);
    for (const src of [...new Set(scripts)].slice(0, 20)) {
      const js = await (await fetch(src)).text();
      if (!js.includes("TweetResultByRestId")) continue;
      const m =
        js.match(
          /queryId:"([A-Za-z0-9-_]+)"[^]{0,200}?operationName:"TweetResultByRestId"/,
        ) ||
        js.match(
          /operationName:"TweetResultByRestId"[^]{0,200}?queryId:"([A-Za-z0-9-_]+)"/,
        );
      if (m?.[1]) {
        cachedTweetQueryId = m[1];
        return m[1];
      }
    }
  } catch (err) {
    console.error("healTweetResultQueryId failed:", err);
  }
  return null;
}

/**
 * Fetch parent/OP tweet text by rest id. Soft-fails to null.
 * Cached per process (success and miss).
 */
export async function fetchParentTweet(opts: {
  tweetId: string;
  session?: SessionCreds;
  signal?: AbortSignal;
}): Promise<ParentTweet | null> {
  const tweetId = opts.tweetId.trim();
  if (!tweetId) return null;
  if (opts.signal?.aborted) return null;
  if (parentCache.has(tweetId)) return parentCache.get(tweetId) ?? null;

  const session = opts.session ?? getSessionFromEnv();
  if (!session.configured) {
    parentCache.set(tweetId, null);
    return null;
  }

  const features = searchFeatures();
  const headers = {
    ...buildSessionHeaders(session),
    "content-type": "application/json",
    referer: `https://x.com/i/status/${tweetId}`,
  };

  const tryIds = [
    getTweetResultQueryId(),
    ...DEFAULT_TWEET_RESULT_QUERY_IDS.filter(
      (id) => id !== getTweetResultQueryId(),
    ),
  ];

  for (let attempt = 0; attempt < tryIds.length + 1; attempt++) {
    if (opts.signal?.aborted) return null;
    const qid =
      attempt < tryIds.length
        ? tryIds[attempt]
        : (await healTweetResultQueryId(session)) || tryIds[0];

    const variables = {
      tweetId,
      withCommunity: false,
      includePromotedContent: false,
      withVoice: false,
    };
    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(features),
    });
    const url = `https://x.com/i/api/graphql/${qid}/TweetResultByRestId?${params}`;

    let res: Response;
    try {
      const ac = new AbortController();
      const tm = setTimeout(() => ac.abort(), 12000);
      const onAbort = () => ac.abort();
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        res = await fetch(url, {
          method: "GET",
          headers,
          signal: ac.signal,
        });
      } finally {
        clearTimeout(tm);
        opts.signal?.removeEventListener("abort", onAbort);
      }
    } catch {
      continue;
    }

    let text = "";
    try {
      text = await res.text();
    } catch {
      continue;
    }
    if (res.status === 404 || text.includes("Query not found")) continue;
    if (!res.ok) continue;

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      continue;
    }

    const parent = parseTweetResultPayload(data);
    if (parent) {
      cachedTweetQueryId = qid;
      parentCache.set(tweetId, parent);
      return parent;
    }
  }

  parentCache.set(tweetId, null);
  return null;
}

/**
 * Fetch engagement metrics for a tweet by rest id. Soft-fails to null.
 * Cached per process (success and miss).
 */
export async function fetchTweetMetrics(opts: {
  tweetId: string;
  session?: SessionCreds;
  signal?: AbortSignal;
}): Promise<TweetMetrics | null> {
  const tweetId = opts.tweetId.trim();
  if (!tweetId) return null;
  if (opts.signal?.aborted) return null;
  if (metricsCache.has(tweetId)) return metricsCache.get(tweetId) ?? null;

  const session = opts.session ?? getSessionFromEnv();
  if (!session.configured) {
    metricsCache.set(tweetId, null);
    return null;
  }

  const features = searchFeatures();
  const headers = {
    ...buildSessionHeaders(session),
    "content-type": "application/json",
    referer: `https://x.com/i/status/${tweetId}`,
  };

  const tryIds = [
    getTweetResultQueryId(),
    ...DEFAULT_TWEET_RESULT_QUERY_IDS.filter(
      (id) => id !== getTweetResultQueryId(),
    ),
  ];

  for (let attempt = 0; attempt < tryIds.length + 1; attempt++) {
    if (opts.signal?.aborted) return null;
    const qid =
      attempt < tryIds.length
        ? tryIds[attempt]
        : (await healTweetResultQueryId(session)) || tryIds[0];

    const variables = {
      tweetId,
      withCommunity: false,
      includePromotedContent: false,
      withVoice: false,
    };
    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(features),
    });
    const url = `https://x.com/i/api/graphql/${qid}/TweetResultByRestId?${params}`;

    let res: Response;
    try {
      const ac = new AbortController();
      const tm = setTimeout(() => ac.abort(), 12000);
      const onAbort = () => ac.abort();
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        res = await fetch(url, {
          method: "GET",
          headers,
          signal: ac.signal,
        });
      } finally {
        clearTimeout(tm);
        opts.signal?.removeEventListener("abort", onAbort);
      }
    } catch {
      continue;
    }

    let text = "";
    try {
      text = await res.text();
    } catch {
      continue;
    }
    if (res.status === 404 || text.includes("Query not found")) continue;
    if (!res.ok) continue;

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      continue;
    }

    const metrics = parseTweetMetrics(data);
    if (metrics) {
      cachedTweetQueryId = qid;
      metricsCache.set(tweetId, metrics);
      return metrics;
    }
  }

  metricsCache.set(tweetId, null);
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fill opAuthor/opText on reply cards missing OP text (before triage).
 */
export async function hydrateReplyParents(opts: {
  threads: import("./xSearch.js").ThreadCard[];
  session?: SessionCreds;
  signal?: AbortSignal;
  delayMs?: number;
  fetchParent?: typeof fetchParentTweet;
}): Promise<import("./xSearch.js").ThreadCard[]> {
  const fetchParent = opts.fetchParent ?? fetchParentTweet;
  const delayMs = opts.delayMs ?? 400;
  const out = [...opts.threads];
  let lookedUp = 0;

  for (let i = 0; i < out.length; i++) {
    if (opts.signal?.aborted) break;
    const t = out[i];
    if (!t.inReplyToId || t.opText) continue;
    if (lookedUp > 0) await sleep(delayMs);
    lookedUp += 1;
    const parent = await fetchParent({
      tweetId: t.inReplyToId,
      session: opts.session,
      signal: opts.signal,
    });
    if (!parent) continue;
    out[i] = {
      ...t,
      opAuthor: parent.author,
      opText: parent.text.slice(0, 500),
    };
  }
  return out;
}
