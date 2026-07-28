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

function parseTweetResultPayload(data: unknown): ParentTweet | null {
  const root = data as {
    data?: {
      tweetResult?: { result?: unknown };
      tweet_result?: { result?: unknown };
    };
  };
  const result =
    root?.data?.tweetResult?.result ?? root?.data?.tweet_result?.result;
  const card = tweetResultToCard(result);
  if (!card?.author || !card.text) return null;
  return { author: card.author, text: card.text };
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
