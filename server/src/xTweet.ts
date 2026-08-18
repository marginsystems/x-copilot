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

export async function postUserReply(opts: {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  text: string;
  inReplyToId: string;
  fetchImpl?: typeof fetch;
}): Promise<PostUserReplyResult> {
  const text = opts.text.trim();
  const inReplyToId = opts.inReplyToId.trim();
  if (!text) {
    return { ok: false, status: 400, error: "empty", message: "Reply is empty." };
  }
  if (!/^\d+$/.test(inReplyToId)) {
    return {
      ok: false,
      status: 400,
      error: "bad_parent",
      message: "inReplyToId must be a numeric status id.",
    };
  }
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
      body: JSON.stringify({
        text,
        reply: { in_reply_to_tweet_id: inReplyToId },
      }),
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
