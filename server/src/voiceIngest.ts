/**
 * Official-API pull of the user's latest public posts (app-only bearer).
 * GET /2/users/by/username + GET /2/users/:id/tweets — no user tokens,
 * no tweet.write, no scraping. Protected accounts come back as a clear
 * error, never a workaround.
 *
 * Voice learns how they write, so originals, replies, self-threads, and
 * quotes all count. Retweets do not — those are someone else's words.
 * Initial onboarding is one page of 100. That is the spend cap.
 */
import { xApiGet, type XApiGetResult } from "./xApi.js";
import type { VoiceReplyInput } from "./voiceStore.js";

/** Full learn targets this many of their latest public posts. */
export const VOICE_TARGET_POSTS = 100;

/** @deprecated Use VOICE_TARGET_POSTS. */
export const VOICE_TARGET_REPLIES = VOICE_TARGET_POSTS;

/** One page of max_results=100 — the onboarding spend bound. */
export const MAX_TIMELINE_PAGES = 1;

export type XApiGetFn = typeof xApiGet;

export type ResolveUserResult =
  | { ok: true; id: string; username: string; protected: boolean }
  | { ok: false; status: number; error: string; message: string };

export async function resolveXUser(
  username: string,
  deps?: { get?: XApiGetFn },
): Promise<ResolveUserResult> {
  const get = deps?.get ?? xApiGet;
  const handle = username.trim().replace(/^@+/, "");
  const result = await get({
    path: `/users/by/username/${encodeURIComponent(handle)}`,
    query: { "user.fields": "protected" },
  });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error,
      message: result.message,
    };
  }
  const data = (result.json as { data?: Record<string, unknown> })?.data;
  const id = typeof data?.id === "string" ? data.id : "";
  if (!id) {
    return {
      ok: false,
      status: 404,
      error: "x_user_not_found",
      message: `No X account found for @${handle}.`,
    };
  }
  return {
    ok: true,
    id,
    username: typeof data?.username === "string" ? data.username : handle,
    protected: data?.protected === true,
  };
}

type RawTweet = {
  id?: unknown;
  text?: unknown;
  conversation_id?: unknown;
  created_at?: unknown;
  in_reply_to_user_id?: unknown;
  referenced_tweets?: unknown;
};

function repliedToId(tweet: RawTweet): string | null {
  if (!Array.isArray(tweet.referenced_tweets)) return null;
  for (const ref of tweet.referenced_tweets) {
    const r = ref as { type?: unknown; id?: unknown };
    if (r?.type === "replied_to" && typeof r.id === "string") return r.id;
  }
  return null;
}

function isRetweet(tweet: RawTweet): boolean {
  if (!Array.isArray(tweet.referenced_tweets)) return false;
  return tweet.referenced_tweets.some((ref) => {
    const r = ref as { type?: unknown };
    return r?.type === "retweeted";
  });
}

/**
 * Keep one /users/:id/tweets page of their own writing: originals, replies
 * (including self-threads), and quotes. Drop retweets.
 */
export function parseUserTweetsPage(
  json: unknown,
  _ownXUserId: string,
): { replies: VoiceReplyInput[]; nextToken: string | null; newestId: string | null } {
  const root = json as {
    data?: unknown;
    meta?: { next_token?: unknown; newest_id?: unknown };
  };
  const replies: VoiceReplyInput[] = [];
  if (Array.isArray(root?.data)) {
    for (const item of root.data) {
      const tweet = item as RawTweet;
      if (typeof tweet.id !== "string" || typeof tweet.text !== "string") {
        continue;
      }
      if (isRetweet(tweet)) continue;
      const createdMs =
        typeof tweet.created_at === "string" ? Date.parse(tweet.created_at) : NaN;
      replies.push({
        id: tweet.id,
        text: tweet.text,
        conversationId:
          typeof tweet.conversation_id === "string"
            ? tweet.conversation_id
            : null,
        inReplyToId: repliedToId(tweet),
        postedAt: Number.isFinite(createdMs)
          ? new Date(createdMs).toISOString()
          : null,
        source: "api",
      });
    }
  }
  return {
    replies,
    nextToken:
      typeof root?.meta?.next_token === "string" ? root.meta.next_token : null,
    newestId:
      typeof root?.meta?.newest_id === "string" ? root.meta.newest_id : null,
  };
}

export type PullRepliesResult =
  | {
      ok: true;
      replies: VoiceReplyInput[];
      newestId: string | null;
      pages: number;
      /** True when the pull ran to completion: target reached or the
       *  timeline was exhausted. False on a truncated break (mid-pagination
       *  error with partial pages, or the page cap) — callers must then keep
       *  the previous since_id so unfetched older pages are not skipped. */
      completed: boolean;
    }
  | { ok: false; status: number; error: string; message: string };

/**
 * Pull the user's latest public posts. Pass sinceId for the hourly
 * incremental so we never re-read the whole history.
 */
export async function pullOwnReplies(opts: {
  xUserId: string;
  sinceId?: string | null;
  targetReplies?: number;
  deps?: { get?: XApiGetFn };
}): Promise<PullRepliesResult> {
  const get = opts.deps?.get ?? xApiGet;
  const target = opts.targetReplies ?? VOICE_TARGET_POSTS;
  const replies: VoiceReplyInput[] = [];
  let paginationToken: string | undefined;
  let newestId: string | null = null;
  let pages = 0;
  let completed = false;

  while (pages < MAX_TIMELINE_PAGES && replies.length < target) {
    const result: XApiGetResult = await get({
      path: `/users/${encodeURIComponent(opts.xUserId)}/tweets`,
      query: {
        max_results: "100",
        exclude: "retweets",
        "tweet.fields":
          "conversation_id,created_at,in_reply_to_user_id,referenced_tweets",
        since_id: opts.sinceId ?? undefined,
        pagination_token: paginationToken,
      },
    });
    if (!result.ok) {
      // Partial progress still counts — a mid-pagination rate limit should
      // not throw away the pages already paid for.
      if (replies.length > 0) break;
      return {
        ok: false,
        status: result.status,
        error: result.error,
        message: result.message,
      };
    }
    pages += 1;
    const page = parseUserTweetsPage(result.json, opts.xUserId);
    replies.push(...page.replies);
    if (!newestId && page.newestId) newestId = page.newestId;
    if (!page.nextToken) {
      completed = true;
      break;
    }
    paginationToken = page.nextToken;
  }
  if (replies.length >= target || pages >= MAX_TIMELINE_PAGES) completed = true;

  return {
    ok: true,
    replies: replies.slice(0, target),
    newestId,
    pages,
    completed,
  };
}
