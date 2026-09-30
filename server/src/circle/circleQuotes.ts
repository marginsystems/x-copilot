import { getPlatformDb } from "../db.js";
import { isRecord, objectValue } from "../platform/unknownValue.js";
import { xApiGet } from "../x-api/xApi.js";
import { recordCircleLinks, upsertXProfiles, type CircleLink } from "./circleStore.js";
import { parseXUsers, toXProfile, type XProfile } from "./xProfiles.js";

export const X_TWEETS_LOOKUP_MAX = 100;
export const CIRCLE_QUOTE_BATCHES_PER_RUN = 3;

export type PendingQuotePost = {
  postId: string;
  xUserId: string;
  quotedPostId: string | null;
  postedAt: string;
};

export type QuoteResolveResult = {
  checked: number;
  linked: number;
  failed: boolean;
};

function parsePendingRow(row: unknown): PendingQuotePost | null {
  if (!isRecord(row)) return null;
  const { id, x_user_id, quoted_post_id, posted_at } = row;
  if (typeof id !== "string" || typeof x_user_id !== "string" || typeof posted_at !== "string") {
    return null;
  }
  return {
    postId: id,
    xUserId: x_user_id,
    quotedPostId: typeof quoted_post_id === "string" && quoted_post_id ? quoted_post_id : null,
    postedAt: posted_at,
  };
}

export function listPendingQuotePosts(userId: string, limit: number): PendingQuotePost[] {
  return getPlatformDb()
    .prepare(
      `SELECT p.id, p.x_user_id, p.quoted_post_id, p.posted_at FROM own_posts p
       WHERE p.user_id = ? AND p.kind = 'quote'
         AND NOT EXISTS (
           SELECT 1 FROM circle_links l WHERE l.user_id = p.user_id AND l.post_id = p.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM circle_quote_checks c WHERE c.user_id = p.user_id AND c.post_id = p.id
         )
       ORDER BY p.posted_at DESC, p.id DESC LIMIT ?`,
    )
    .all(userId, limit)
    .flatMap((row) => {
      const post = parsePendingRow(row);
      return post ? [post] : [];
    });
}

export function markQuotePostsChecked(
  userId: string,
  postIds: readonly string[],
  checkedAt: string,
): void {
  if (postIds.length === 0) return;
  const db = getPlatformDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO circle_quote_checks (user_id, post_id, checked_at) VALUES (?, ?, ?)`,
  );
  db.transaction(() => {
    for (const postId of postIds) stmt.run(userId, postId, checkedAt);
  })();
}

export function quoteLookupId(post: PendingQuotePost): string {
  return post.quotedPostId ?? post.postId;
}

function quotedRefId(tweet: Record<string, unknown>): string | null {
  if (!Array.isArray(tweet.referenced_tweets)) return null;
  for (const ref of tweet.referenced_tweets) {
    const row = objectValue(ref);
    if (row.type === "quoted" && typeof row.id === "string") return row.id;
  }
  return null;
}

export function parseQuoteTargets(
  json: unknown,
  posts: readonly PendingQuotePost[],
  fetchedAt: string,
): { links: CircleLink[]; profiles: XProfile[]; checkedPostIds: string[] } {
  const root = objectValue(json);
  const includes = objectValue(root.includes);
  const unavailable = new Set(
    (Array.isArray(root.errors) ? root.errors : []).flatMap((error) => {
      const resourceId = objectValue(error).resource_id;
      return typeof resourceId === "string" ? [resourceId] : [];
    }),
  );
  const users = new Map(
    parseXUsers(includes.users, fetchedAt).flatMap((user) =>
      user.id ? [[user.id, user] as const] : [],
    ),
  );
  const tweetAuthors = new Map<string, string>();
  const quotedByPost = new Map<string, string>();
  const tweets: unknown[] = [
    ...(Array.isArray(root.data) ? (root.data as unknown[]) : []),
    ...(Array.isArray(includes.tweets) ? (includes.tweets as unknown[]) : []),
  ];
  for (const item of tweets) {
    const tweet = objectValue(item);
    if (typeof tweet.id !== "string") continue;
    if (typeof tweet.author_id === "string") tweetAuthors.set(tweet.id, tweet.author_id);
    const quoted = quotedRefId(tweet);
    if (quoted) quotedByPost.set(tweet.id, quoted);
  }
  const links: CircleLink[] = [];
  const profiles = new Map<string, XProfile>();
  const checkedPostIds: string[] = [];
  for (const post of posts) {
    const quoted = post.quotedPostId ?? quotedByPost.get(post.postId);
    if (!quoted) {
      if (post.quotedPostId === null || unavailable.has(quoteLookupId(post))) {
        checkedPostIds.push(post.postId);
      }
      continue;
    }
    const authorId = tweetAuthors.get(quoted);
    if (!authorId) {
      if (unavailable.has(quoted)) checkedPostIds.push(post.postId);
      continue;
    }
    if (authorId === post.xUserId) {
      checkedPostIds.push(post.postId);
      continue;
    }
    const user = users.get(authorId);
    if (!user) {
      checkedPostIds.push(post.postId);
      continue;
    }
    links.push({ postId: post.postId, authorKey: user.authorKey, kind: "quote", at: post.postedAt });
    profiles.set(user.authorKey, toXProfile(user));
    checkedPostIds.push(post.postId);
  }
  return { links, profiles: [...profiles.values()], checkedPostIds };
}

export async function resolveQuoteTargets(opts: {
  userId: string;
  nowMs: number;
  signal?: AbortSignal;
  maxBatches?: number;
  fetchTweets?: typeof xApiGet;
}): Promise<QuoteResolveResult> {
  const batchSize = X_TWEETS_LOOKUP_MAX;
  const maxBatches = opts.maxBatches ?? CIRCLE_QUOTE_BATCHES_PER_RUN;
  const pending = listPendingQuotePosts(opts.userId, batchSize * maxBatches);
  const fetchedAt = new Date(opts.nowMs).toISOString();
  const result: QuoteResolveResult = { checked: 0, linked: 0, failed: false };
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const response = await (opts.fetchTweets ?? xApiGet)({
      path: "/tweets",
      query: {
        ids: [...new Set(batch.map(quoteLookupId))].join(","),
        expansions: "author_id,referenced_tweets.id.author_id",
        "tweet.fields": "author_id,referenced_tweets",
        "user.fields": "username,name,profile_image_url",
      },
      signal: opts.signal,
      timeoutMs: 8000,
    });
    if (!response.ok) {
      console.warn("circle quote lookup failed:", response.error, response.message);
      result.failed = true;
      break;
    }
    const { links, profiles, checkedPostIds } = parseQuoteTargets(response.json, batch, fetchedAt);
    upsertXProfiles(profiles);
    result.linked += recordCircleLinks(opts.userId, links);
    markQuotePostsChecked(opts.userId, checkedPostIds, fetchedAt);
    result.checked += checkedPostIds.length;
  }
  return result;
}
