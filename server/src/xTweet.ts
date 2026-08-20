/**
 * User-context tweet create (OAuth 1.0a). App bearer cannot post.
 */
import { recordUsageEvent } from "./usageMeter.js";
import { buildSignedAuthHeader } from "./oauth1.js";
import { X_API_BASE } from "./xApi.js";

const CREATE_TWEET_URL = `${X_API_BASE}/tweets`;

export type PostUserReplyResult =
  | { ok: true; tweetId: string }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
    };

export type TweetCreateBody =
  | { text: string }
  | { text: string; reply: { in_reply_to_tweet_id: string } }
  | { text: string; quote_tweet_id: string };

/**
 * Build POST /2/tweets JSON. A tweet is an original, a quote, or a reply —
 * never a mix. Compose callers must not pass inReplyToId.
 */
export function buildTweetCreateBody(opts: {
  text: string;
  inReplyToId?: string;
  quoteTweetId?: string;
}):
  | { ok: true; body: TweetCreateBody }
  | { ok: false; status: number; error: string; message: string } {
  const text = opts.text.trim();
  if (!text) {
    return { ok: false, status: 400, error: "empty", message: "Post is empty." };
  }
  const inReplyToId = opts.inReplyToId?.trim() ?? "";
  const quoteTweetId = opts.quoteTweetId?.trim() ?? "";
  if (inReplyToId && quoteTweetId) {
    return {
      ok: false,
      status: 400,
      error: "mixed_target",
      message: "A post cannot be both a reply and a quote.",
    };
  }
  if (inReplyToId) {
    if (!/^\d+$/.test(inReplyToId)) {
      return {
        ok: false,
        status: 400,
        error: "bad_parent",
        message: "inReplyToId must be a numeric status id.",
      };
    }
    return {
      ok: true,
      body: { text, reply: { in_reply_to_tweet_id: inReplyToId } },
    };
  }
  if (quoteTweetId) {
    if (!/^\d+$/.test(quoteTweetId)) {
      return {
        ok: false,
        status: 400,
        error: "bad_quote",
        message: "quoteTweetId must be a numeric status id.",
      };
    }
    return { ok: true, body: { text, quote_tweet_id: quoteTweetId } };
  }
  return { ok: true, body: { text } };
}

async function createUserTweet(opts: {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  text: string;
  inReplyToId?: string;
  quoteTweetId?: string;
  fetchImpl?: typeof fetch;
}): Promise<PostUserReplyResult> {
  const built = buildTweetCreateBody({
    text: opts.text,
    inReplyToId: opts.inReplyToId,
    quoteTweetId: opts.quoteTweetId,
  });
  if (!built.ok) return built;
  const signed = buildSignedAuthHeader({
    method: "POST",
    url: CREATE_TWEET_URL,
    consumerKey: opts.consumerKey,
    consumerSecret: opts.consumerSecret,
    token: opts.accessToken,
    tokenSecret: opts.accessTokenSecret,
  });
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(CREATE_TWEET_URL, {
      method: "POST",
      headers: {
        Authorization: signed.header,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(built.body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: "network",
      message: err instanceof Error ? err.message : "Could not reach X.",
    };
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  recordUsageEvent({
    method: "POST",
    path: "/2/tweets",
    status: res.status,
    error: res.ok ? undefined : "tweet_create_failed",
    postsRead: 0,
  });
  if (!res.ok) {
    const body = json as { title?: string; detail?: string; status?: number };
    return {
      ok: false,
      status: res.status,
      error: "tweet_create_failed",
      message:
        body.detail ||
        body.title ||
        "X refused the post. Re-link X if the app is still read-only.",
    };
  }
  const id = (json as { data?: { id?: string } })?.data?.id?.trim() ?? "";
  if (!/^\d+$/.test(id)) {
    return {
      ok: false,
      status: 502,
      error: "tweet_create_invalid",
      message: "X accepted the post but did not return an id.",
    };
  }
  return { ok: true, tweetId: id };
}

export async function postUserReply(opts: {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  text: string;
  inReplyToId: string;
  fetchImpl?: typeof fetch;
}): Promise<PostUserReplyResult> {
  if (!opts.inReplyToId.trim()) {
    return {
      ok: false,
      status: 400,
      error: "bad_parent",
      message: "inReplyToId must be a numeric status id.",
    };
  }
  return createUserTweet({
    ...opts,
    inReplyToId: opts.inReplyToId,
  });
}

/** Original or quote on the operator's own timeline. Never a reply. */
export async function postUserTweet(opts: {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  text: string;
  quoteTweetId?: string;
  fetchImpl?: typeof fetch;
}): Promise<PostUserReplyResult> {
  return createUserTweet({
    ...opts,
    quoteTweetId: opts.quoteTweetId,
  });
}
