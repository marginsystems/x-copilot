import { isRecord } from "../platform/unknownValue.js";
/**
 * Durable own-post ingest + watch list for Activity API post.create.
 */
import { getPlatformDb } from "../db.js";
import type { ActivityMetrics, OwnPostKind, ParsedPostCreate } from "../x-api/xActivity.js";
import { postUrl } from "../x-api/xActivity.js";

export type OwnPostRow = {
  id: string;
  userId: string;
  tenantId: string;
  xUserId: string;
  kind: OwnPostKind;
  text: string | null;
  postedAt: string;
  inReplyToId: string | null;
  url: string | null;
  views: number;
  likes: number;
  replies: number;
  retweets: number;
  bookmarks: number;
};

export type SnapshotSlot = "t0" | "t1h" | "t24h";

export function startOfUtcDayIso(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

export function nextUtcDayIso(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();
}

export function nextUtcMonthIso(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  ).toISOString();
}

export function seenActivityEvent(eventUuid: string): boolean {
  const row = parseSeenActivityEventRow(getPlatformDb()
    .prepare(`SELECT event_uuid FROM activity_event_ids WHERE event_uuid = ?`)
    .get(eventUuid));
  return Boolean(row);
}

export function rememberActivityEvent(eventUuid: string, at = new Date().toISOString()): void {
  getPlatformDb()
    .prepare(
      `INSERT OR IGNORE INTO activity_event_ids (event_uuid, at) VALUES (?, ?)`,
    )
    .run(eventUuid, at);
}

export function pruneActivityEvents(beforeIso: string): number {
  const info = getPlatformDb()
    .prepare(`DELETE FROM activity_event_ids WHERE at < ?`)
    .run(beforeIso);
  return info.changes;
}

export type ActivityOwnPost = {
  t24hViews?: number | null;
  id: string;
  kind: OwnPostKind;
  postedAt: string;
  views: number;
  withStats: boolean;
};

function snapshotHasViews(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Authored posts for the flight-path window. Reposts stay out — the desk
 * only stacks originals, quotes, and replies. Uncapped within the window so
 * a 12-week series is not truncated by the Analytics 200-row reader.
 */
export function listActivityOwnPosts(opts: {
  userId: string;
  sinceIso: string;
}): ActivityOwnPost[] {
  const rows = parseListActivityOwnPostsRow(getPlatformDb()
    .prepare(
      `SELECT id, kind, posted_at, t24h_views, t1h_views, t0_views
         FROM own_posts
        WHERE user_id = ? AND posted_at >= ? AND kind != 'repost'
        ORDER BY posted_at DESC`,
    )
    .all(opts.userId, opts.sinceIso));
  return rows.map((row) => ({
    id: String(row.id),
    kind: row.kind,
    postedAt: String(row.posted_at),
    views: pickLatest(row.t24h_views, row.t1h_views, row.t0_views),
    t24hViews: row.t24h_views,
    withStats:
      snapshotHasViews(row.t24h_views) ||
      snapshotHasViews(row.t1h_views),
  }));
}

/** Newest `posted_at` values for the given kinds, newest first. */
export function listOwnPostedAt(opts: {
  userId: string;
  kinds: OwnPostKind[];
  limit?: number;
}): string[] {
  const kinds = opts.kinds.filter(Boolean);
  if (kinds.length === 0) return [];
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  const placeholders = kinds.map(() => "?").join(", ");
  const rows = parseListOwnPostedAtRow(getPlatformDb()
    .prepare(
      `SELECT posted_at FROM own_posts
        WHERE user_id = ? AND kind IN (${placeholders})
        ORDER BY posted_at DESC LIMIT ?`,
    )
    .all(opts.userId, ...kinds, limit));
  return rows.map((row) => String(row.posted_at));
}

export function listOwnOriginalsSince(
  userId: string,
  sinceIso: string,
): Array<{ tweetId: string; postedAt: string }> {
  const rows = parseListOwnOriginalsSinceRow(getPlatformDb()
    .prepare(
      `SELECT id AS tweetId, posted_at AS postedAt FROM own_posts
         WHERE user_id = ? AND kind = 'original' AND posted_at >= ?
         ORDER BY posted_at DESC LIMIT 2000`,
    )
    .all(userId, sinceIso));
  return rows;
}

export function countOwnPostsSince(
  userId: string,
  sinceIso: string,
): number {
  const row = parseCountOwnPostsSinceRow(getPlatformDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM own_posts WHERE user_id = ? AND posted_at >= ?`,
    )
    .get(userId, sinceIso));
  return Number(row?.n ?? 0);
}

export type ConfirmedOwnReply = {
  id: string;
  userId: string;
  text: string;
  postedAt: string;
  inReplyToId: string | null;
  conversationId: string | null;
  url: string | null;
};

/** Bounded owner-scoped replies that already have confirmed local text. */
export function listConfirmedOwnReplies(opts: {
  userId: string;
  limit?: number;
}): ConfirmedOwnReply[] {
  const limit = Math.min(Math.max(opts.limit ?? 80, 1), 200);
  const rows = parseListConfirmedOwnRepliesRow(getPlatformDb()
    .prepare(
      `SELECT id, user_id, text, posted_at, in_reply_to_id, conversation_id, url
         FROM own_posts
        WHERE user_id = ?
          AND kind = 'reply'
          AND text IS NOT NULL
          AND length(trim(text)) > 0
        ORDER BY posted_at DESC
        LIMIT ?`,
    )
    .all(opts.userId, limit));
  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    text: String(row.text),
    postedAt: String(row.posted_at),
    inReplyToId: row.in_reply_to_id ? String(row.in_reply_to_id) : null,
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
    url: row.url ? String(row.url) : null,
  }));
}

/**
 * Keyset page of confirmed own replies (newest first) for bounded evidence
 * reconciliation. Optional `replyId` narrows to one post; `before` resumes
 * after the prior page; self-replies (to the operator's own X id) are
 * never Scout takes.
 */
export function listConfirmedOwnRepliesPage(opts: {
  userId: string;
  limit: number;
  before?: { postedAt: string; id: string };
  replyId?: string;
  excludeSelfReplies?: boolean;
}): ConfirmedOwnReply[] {
  const limit = Math.min(Math.max(opts.limit, 1), 500);
  const clauses = [
    "user_id = ?",
    "kind = 'reply'",
    "text IS NOT NULL",
    "length(trim(text)) > 0",
  ];
  const params: unknown[] = [opts.userId];
  if (opts.replyId) {
    clauses.push("id = ?");
    params.push(opts.replyId);
  }
  if (opts.excludeSelfReplies) {
    clauses.push(
      "(own_posts.in_reply_to_user_id IS NULL OR own_posts.x_user_id <> own_posts.in_reply_to_user_id)",
    );
    clauses.push(
      "NOT EXISTS (SELECT 1 FROM activity_subscriptions AS subscriptions WHERE subscriptions.user_id = own_posts.user_id AND subscriptions.x_user_id = own_posts.in_reply_to_user_id) AND NOT EXISTS (SELECT 1 FROM own_posts AS parent WHERE parent.user_id = own_posts.user_id AND parent.id = own_posts.in_reply_to_id)",
    );
  }
  if (opts.before) {
    clauses.push("(posted_at < ? OR (posted_at = ? AND id < ?))");
    params.push(opts.before.postedAt, opts.before.postedAt, opts.before.id);
  }
  const rows = parseListConfirmedOwnRepliesPageRow(getPlatformDb()
    .prepare(
      `SELECT id, user_id, text, posted_at, in_reply_to_id, conversation_id, url
         FROM own_posts
        WHERE ${clauses.join(" AND ")}
        ORDER BY posted_at DESC, id DESC
        LIMIT ?`,
    )
    .all(...params, limit));
  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    text: String(row.text),
    postedAt: String(row.posted_at),
    inReplyToId: row.in_reply_to_id ? String(row.in_reply_to_id) : null,
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
    url: row.url ? String(row.url) : null,
  }));
}

export function upsertOwnPost(input: {
  parsed: ParsedPostCreate;
  userId: string;
  tenantId: string;
}): boolean {
  const db = getPlatformDb();
  const existing = parseUpsertOwnPostRow(db
    .prepare(`SELECT id FROM own_posts WHERE id = ?`)
    .get(input.parsed.postId));
  const url = postUrl(input.parsed.authorUsername, input.parsed.postId);
  const m = input.parsed.metrics;
  const now = new Date().toISOString();
  const postedAtFallback = input.parsed.postedAtFallback ? 1 : 0;
  db.prepare(
    `INSERT INTO own_posts (
       id, user_id, tenant_id, x_user_id, kind, text, posted_at,
       in_reply_to_id, in_reply_to_user_id, conversation_id, url,
       t0_views, t0_likes, t0_replies, t0_retweets, t0_bookmarks, t0_at,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       text = excluded.text,
       kind = excluded.kind,
       url = excluded.url,
       posted_at = CASE
         WHEN own_posts.posted_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'
           THEN excluded.posted_at
         WHEN ? = 1
           THEN own_posts.posted_at
         ELSE excluded.posted_at
       END`,
  ).run(
    input.parsed.postId,
    input.userId,
    input.tenantId,
    input.parsed.xUserId,
    input.parsed.kind,
    input.parsed.text || null,
    input.parsed.postedAt,
    input.parsed.inReplyToId,
    input.parsed.inReplyToUserId,
    input.parsed.conversationId,
    url,
    m.views ?? null,
    m.likes ?? null,
    m.replies ?? null,
    m.retweets ?? null,
    m.bookmarks ?? null,
    now,
    now,
    postedAtFallback,
  );
  return !existing;
}

export function removeOwnPost(input: {
  postId: string;
  userId: string;
  xUserId: string;
}): boolean {
  const result = getPlatformDb()
    .prepare(
      `DELETE FROM own_posts
       WHERE id = ? AND user_id = ? AND x_user_id = ?`,
    )
    .run(input.postId, input.userId, input.xUserId);
  return result.changes > 0;
}

export function patchOwnPostSnapshot(
  postId: string,
  slot: "t1h" | "t24h",
  metrics: ActivityMetrics,
  at = new Date().toISOString(),
): void {
  const prefix = slot;
  getPlatformDb()
    .prepare(
      `UPDATE own_posts SET
         ${prefix}_views = ?,
         ${prefix}_likes = ?,
         ${prefix}_replies = ?,
         ${prefix}_retweets = ?,
         ${prefix}_bookmarks = ?,
         ${prefix}_at = ?
       WHERE id = ?`,
    )
    .run(
      metrics.views ?? null,
      metrics.likes ?? null,
      metrics.replies ?? null,
      metrics.retweets ?? null,
      metrics.bookmarks ?? null,
      at,
      postId,
    );
}

export type DueOwnPostSample = {
  postId: string;
  userId: string;
  tenantId: string;
  postedAt: string;
  checkpoint: "t1h" | "t24h";
};

export function listDueOwnPostSamples(opts?: {
  nowMs?: number;
  limit?: number;
}): DueOwnPostSample[] {
  const nowMs = opts?.nowMs ?? Date.now();
  // Allow oversampling (sibling interaction due loop fetches tickCap * 20) so
  // permanently-failing rows do not consume the caller's whole sampling budget.
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 300);
  const t1hBefore = new Date(nowMs - 60 * 60 * 1000).toISOString();
  const t24hBefore = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  // Round-robin across tenants (ROW_NUMBER partitioned by tenant_id, ordered by
  // posted_at) so one high-volume tenant's oldest-first backlog cannot occupy
  // the whole oversample window and starve every other tenant's snapshots.
  const rows = parseListDueOwnPostSamplesRow(getPlatformDb()
    .prepare(
      `SELECT id, user_id, tenant_id, posted_at, t1h_at, t24h_at
       FROM (
         SELECT id, user_id, tenant_id, posted_at, t1h_at, t24h_at,
                ROW_NUMBER() OVER (
                  PARTITION BY tenant_id ORDER BY posted_at ASC
                ) AS rn
         FROM own_posts
         WHERE (t1h_at IS NULL AND posted_at <= ?)
            OR (t24h_at IS NULL AND posted_at <= ?)
       )
       WHERE rn <= ?
       ORDER BY rn ASC, posted_at ASC
       LIMIT ?`,
    )
    .all(t1hBefore, t24hBefore, limit, limit * 2));
  const out: DueOwnPostSample[] = [];
  for (const row of rows) {
    if (!row.t1h_at && row.posted_at <= t1hBefore) {
      out.push({
        postId: row.id,
        userId: row.user_id,
        tenantId: row.tenant_id,
        postedAt: row.posted_at,
        checkpoint: "t1h",
      });
    } else if (!row.t24h_at && row.posted_at <= t24hBefore) {
      out.push({
        postId: row.id,
        userId: row.user_id,
        tenantId: row.tenant_id,
        postedAt: row.posted_at,
        checkpoint: "t24h",
      });
    }
    if (out.length >= limit) break;
  }
  return out;
}

export function watchThread(input: {
  userId: string;
  threadId: string;
  author?: string;
  url?: string;
  text?: string;
  conversationId?: string;
}): void {
  const threadId = input.threadId.trim();
  if (!threadId) return;
  getPlatformDb()
    .prepare(
      `INSERT INTO watched_threads
         (user_id, thread_id, author, url, text, conversation_id, seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, thread_id) DO UPDATE SET
         author = COALESCE(excluded.author, watched_threads.author),
         url = COALESCE(excluded.url, watched_threads.url),
         text = COALESCE(excluded.text, watched_threads.text),
         seen_at = excluded.seen_at`,
    )
    .run(
      input.userId,
      threadId,
      input.author?.trim() || null,
      input.url?.trim() || null,
      input.text?.trim() || null,
      input.conversationId?.trim() || null,
      new Date().toISOString(),
    );
}

export function getWatchedThread(
  userId: string,
  threadId: string,
): {
  threadId: string;
  author: string | null;
  url: string | null;
  text: string | null;
  conversationId: string | null;
} | null {
  const row = parseGetWatchedThreadRow(getPlatformDb()
    .prepare(
      `SELECT thread_id, author, url, text, conversation_id
       FROM watched_threads WHERE user_id = ? AND thread_id = ?`,
    )
    .get(userId, threadId));
  if (!row) return null;
  return {
    threadId: row.thread_id,
    author: row.author,
    url: row.url,
    text: row.text,
    conversationId: row.conversation_id,
  };
}

function pickLatest(
  t24: number | null,
  t1: number | null,
  t0: number | null,
): number {
  return Number(t24 ?? t1 ?? t0 ?? 0);
}

export function listAnalyticsPosts(opts: {
  userId: string;
  limit?: number;
}): OwnPostRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 80, 1), 200);
  const rows = parseListAnalyticsPostsRow(getPlatformDb()
    .prepare(
      `SELECT * FROM own_posts WHERE user_id = ? ORDER BY posted_at DESC LIMIT ?`,
    )
    .all(opts.userId, limit));
  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    tenantId: String(row.tenant_id),
    xUserId: String(row.x_user_id),
    kind: row.kind,
    text: (row.text) ?? null,
    postedAt: String(row.posted_at),
    inReplyToId: (row.in_reply_to_id) ?? null,
    url: (row.url) ?? null,
    views: pickLatest(
      row.t24h_views,
      row.t1h_views,
      row.t0_views,
    ),
    likes: pickLatest(
      row.t24h_likes,
      row.t1h_likes,
      row.t0_likes,
    ),
    replies: pickLatest(
      row.t24h_replies,
      row.t1h_replies,
      row.t0_replies,
    ),
    retweets: pickLatest(
      row.t24h_retweets,
      row.t1h_retweets,
      row.t0_retweets,
    ),
    bookmarks: pickLatest(
      row.t24h_bookmarks,
      row.t1h_bookmarks,
      row.t0_bookmarks,
    ),
  }));
}

/** The last `days` UTC calendar days ending today, as YYYY-MM-DD. */
export function lastUtcDays(days: number, now = new Date()): string[] {
  const startMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - (days - 1),
  );
  return Array.from({ length: days }, (_, i) =>
    new Date(startMs + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
}

export function analyticsSummary(userId: string, now = new Date()): {
  totals: {
    posts: number;
    originals: number;
    replies: number;
    quotes: number;
    reposts: number;
    views: number;
    likes: number;
    replyCount: number;
    retweets: number;
    bookmarks: number;
  };
  series: Array<{ day: string; posts: number; views: number; likes: number }>;
  kinds: Array<{ key: OwnPostKind; count: number }>;
  top: OwnPostRow[];
} {
  const db = getPlatformDb();
  const totalsRow = parseAnalyticsSummaryRow(db
    .prepare(
      `SELECT
         COUNT(*) AS posts,
         SUM(CASE WHEN kind = 'original' THEN 1 ELSE 0 END) AS originals,
         SUM(CASE WHEN kind = 'reply' THEN 1 ELSE 0 END) AS replies,
         SUM(CASE WHEN kind = 'quote' THEN 1 ELSE 0 END) AS quotes,
         SUM(CASE WHEN kind = 'repost' THEN 1 ELSE 0 END) AS reposts,
         COALESCE(SUM(COALESCE(t24h_views, t1h_views, t0_views, 0)), 0) AS views,
         COALESCE(SUM(COALESCE(t24h_likes, t1h_likes, t0_likes, 0)), 0) AS likes,
         COALESCE(SUM(COALESCE(t24h_replies, t1h_replies, t0_replies, 0)), 0) AS reply_count,
         COALESCE(SUM(COALESCE(t24h_retweets, t1h_retweets, t0_retweets, 0)), 0) AS retweets,
         COALESCE(SUM(COALESCE(t24h_bookmarks, t1h_bookmarks, t0_bookmarks, 0)), 0) AS bookmarks
       FROM own_posts WHERE user_id = ?`,
    )
    .get(userId));
  const totals = {
    posts: Number(totalsRow.posts ?? 0),
    originals: Number(totalsRow.originals ?? 0),
    replies: Number(totalsRow.replies ?? 0),
    quotes: Number(totalsRow.quotes ?? 0),
    reposts: Number(totalsRow.reposts ?? 0),
    views: Number(totalsRow.views ?? 0),
    likes: Number(totalsRow.likes ?? 0),
    replyCount: Number(totalsRow.reply_count ?? 0),
    retweets: Number(totalsRow.retweets ?? 0),
    bookmarks: Number(totalsRow.bookmarks ?? 0),
  };
  const dayRows = parseAnalyticsSummaryRow2(db
    .prepare(
      `SELECT substr(posted_at, 1, 10) AS day,
         COUNT(*) AS posts,
         COALESCE(SUM(COALESCE(t24h_views, t1h_views, t0_views, 0)), 0) AS views,
         COALESCE(SUM(COALESCE(t24h_likes, t1h_likes, t0_likes, 0)), 0) AS likes
       FROM own_posts WHERE user_id = ?
       GROUP BY day ORDER BY day ASC`,
    )
    .all(userId));
  // A continuous 30-day UTC window (zero-filled) so the chart's x-axis is a
  // real calendar strip, not a sparse cluster of posting days.
  const byDay = new Map(dayRows.map((r) => [r.day, r]));
  const series = lastUtcDays(30, now).map((day) => {
    const r = byDay.get(day);
    return {
      day,
      posts: Number(r?.posts ?? 0),
      views: Number(r?.views ?? 0),
      likes: Number(r?.likes ?? 0),
    };
  });
  const kinds: Array<{ key: OwnPostKind; count: number }> = (
    [
      ["original", totals.originals],
      ["reply", totals.replies],
      ["quote", totals.quotes],
      ["repost", totals.reposts],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ key, count }));
  const top = [...listAnalyticsPosts({ userId, limit: 200 })]
    .sort((a, b) => b.views - a.views)
    .slice(0, 8);
  return { totals, series, kinds, top };
}

function parseSeenActivityEventRow(value: unknown): { event_uuid: string } | undefined {
  const valid = (row: unknown): row is { event_uuid: string } | undefined =>
    (row === undefined || (isRecord(row) &&
    typeof row.event_uuid === "string"));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseListActivityOwnPostsRow(value: unknown): Array<{
    id: string;
    kind: OwnPostKind;
    posted_at: string;
    t24h_views: number | null;
    t1h_views: number | null;
    t0_views: number | null;
  }> {
  const valid = (row: unknown): row is Array<{
    id: string;
    kind: OwnPostKind;
    posted_at: string;
    t24h_views: number | null;
    t1h_views: number | null;
    t0_views: number | null;
  }> =>
    (Array.isArray(row) && row.every((item: unknown) => (isRecord(item) &&
    typeof item.id === "string" &&
    (item.kind === "original" || item.kind === "reply" || item.kind === "quote" || item.kind === "repost") &&
    typeof item.posted_at === "string" &&
    (item.t24h_views === null || typeof item.t24h_views === "number") &&
    (item.t1h_views === null || typeof item.t1h_views === "number") &&
    (item.t0_views === null || typeof item.t0_views === "number"))));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseListOwnPostedAtRow(value: unknown): Array<{ posted_at: string }> {
  const valid = (row: unknown): row is Array<{ posted_at: string }> =>
    (Array.isArray(row) && row.every((item: unknown) => (isRecord(item) &&
    typeof item.posted_at === "string")));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseListOwnOriginalsSinceRow(value: unknown): Array<{ tweetId: string; postedAt: string }> {
  const valid = (row: unknown): row is Array<{ tweetId: string; postedAt: string }> =>
    (Array.isArray(row) && row.every((item: unknown) => (isRecord(item) &&
    typeof item.tweetId === "string" &&
    typeof item.postedAt === "string")));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseCountOwnPostsSinceRow(value: unknown): { n: number } {
  const valid = (row: unknown): row is { n: number } =>
    (isRecord(row) &&
    typeof row.n === "number");
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseListConfirmedOwnRepliesRow(value: unknown): Array<{
      id: string;
      user_id: string;
      text: string;
      posted_at: string;
      in_reply_to_id: string | null;
      conversation_id: string | null;
      url: string | null;
    }> {
  const valid = (row: unknown): row is Array<{
      id: string;
      user_id: string;
      text: string;
      posted_at: string;
      in_reply_to_id: string | null;
      conversation_id: string | null;
      url: string | null;
    }> =>
    (Array.isArray(row) && row.every((item: unknown) => (isRecord(item) &&
    typeof item.id === "string" &&
    typeof item.user_id === "string" &&
    typeof item.text === "string" &&
    typeof item.posted_at === "string" &&
    (item.in_reply_to_id === null || typeof item.in_reply_to_id === "string") &&
    (item.conversation_id === null || typeof item.conversation_id === "string") &&
    (item.url === null || typeof item.url === "string"))));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseListConfirmedOwnRepliesPageRow(value: unknown): Array<{
      id: string;
      user_id: string;
      text: string;
      posted_at: string;
      in_reply_to_id: string | null;
      conversation_id: string | null;
      url: string | null;
    }> {
  const valid = (row: unknown): row is Array<{
      id: string;
      user_id: string;
      text: string;
      posted_at: string;
      in_reply_to_id: string | null;
      conversation_id: string | null;
      url: string | null;
    }> =>
    (Array.isArray(row) && row.every((item: unknown) => (isRecord(item) &&
    typeof item.id === "string" &&
    typeof item.user_id === "string" &&
    typeof item.text === "string" &&
    typeof item.posted_at === "string" &&
    (item.in_reply_to_id === null || typeof item.in_reply_to_id === "string") &&
    (item.conversation_id === null || typeof item.conversation_id === "string") &&
    (item.url === null || typeof item.url === "string"))));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseUpsertOwnPostRow(value: unknown): { id: string } | undefined {
  const valid = (row: unknown): row is { id: string } | undefined =>
    (row === undefined || (isRecord(row) &&
    typeof row.id === "string"));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseListDueOwnPostSamplesRow(value: unknown): Array<{
    id: string;
    user_id: string;
    tenant_id: string;
    posted_at: string;
    t1h_at: string | null;
    t24h_at: string | null;
  }> {
  const valid = (row: unknown): row is Array<{
    id: string;
    user_id: string;
    tenant_id: string;
    posted_at: string;
    t1h_at: string | null;
    t24h_at: string | null;
  }> =>
    (Array.isArray(row) && row.every((item: unknown) => (isRecord(item) &&
    typeof item.id === "string" &&
    typeof item.user_id === "string" &&
    typeof item.tenant_id === "string" &&
    typeof item.posted_at === "string" &&
    (item.t1h_at === null || typeof item.t1h_at === "string") &&
    (item.t24h_at === null || typeof item.t24h_at === "string"))));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseGetWatchedThreadRow(value: unknown): | {
        thread_id: string;
        author: string | null;
        url: string | null;
        text: string | null;
        conversation_id: string | null;
      }
    | undefined {
  const valid = (row: unknown): row is | {
        thread_id: string;
        author: string | null;
        url: string | null;
        text: string | null;
        conversation_id: string | null;
      }
    | undefined =>
    (row === undefined || (isRecord(row) &&
    typeof row.thread_id === "string" &&
    (row.author === null || typeof row.author === "string") &&
    (row.url === null || typeof row.url === "string") &&
    (row.text === null || typeof row.text === "string") &&
    (row.conversation_id === null || typeof row.conversation_id === "string")));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

type AnalyticsPostSqlRow = Record<string, unknown> & {
  kind: OwnPostKind;
  text: string | null;
  in_reply_to_id: string | null;
  url: string | null;
  t0_views: number | null;
  t0_likes: number | null;
  t0_replies: number | null;
  t0_retweets: number | null;
  t0_bookmarks: number | null;
  t1h_views: number | null;
  t1h_likes: number | null;
  t1h_replies: number | null;
  t1h_retweets: number | null;
  t1h_bookmarks: number | null;
  t24h_views: number | null;
  t24h_likes: number | null;
  t24h_replies: number | null;
  t24h_retweets: number | null;
  t24h_bookmarks: number | null;
};

function parseListAnalyticsPostsRow(value: unknown): AnalyticsPostSqlRow[] {
  const valid = (row: unknown): row is AnalyticsPostSqlRow =>
    isRecord(row) &&
    (row.kind === "original" || row.kind === "reply" || row.kind === "quote" || row.kind === "repost") &&
    (row.text === null || typeof row.text === "string") &&
    (row.in_reply_to_id === null || typeof row.in_reply_to_id === "string") &&
    (row.url === null || typeof row.url === "string") &&
    (row.t0_views === null || typeof row.t0_views === "number") &&
    (row.t0_likes === null || typeof row.t0_likes === "number") &&
    (row.t0_replies === null || typeof row.t0_replies === "number") &&
    (row.t0_retweets === null || typeof row.t0_retweets === "number") &&
    (row.t0_bookmarks === null || typeof row.t0_bookmarks === "number") &&
    (row.t1h_views === null || typeof row.t1h_views === "number") &&
    (row.t1h_likes === null || typeof row.t1h_likes === "number") &&
    (row.t1h_replies === null || typeof row.t1h_replies === "number") &&
    (row.t1h_retweets === null || typeof row.t1h_retweets === "number") &&
    (row.t1h_bookmarks === null || typeof row.t1h_bookmarks === "number") &&
    (row.t24h_views === null || typeof row.t24h_views === "number") &&
    (row.t24h_likes === null || typeof row.t24h_likes === "number") &&
    (row.t24h_replies === null || typeof row.t24h_replies === "number") &&
    (row.t24h_retweets === null || typeof row.t24h_retweets === "number") &&
    (row.t24h_bookmarks === null || typeof row.t24h_bookmarks === "number");
  if (!Array.isArray(value) || !value.every(valid)) throw new TypeError("Invalid database row");
  return value;
}

function parseAnalyticsSummaryRow(value: unknown): Record<string, number | null> {
  const valid = (row: unknown): row is Record<string, number | null> =>
    (isRecord(row) && Object.values(row).every((item: unknown) => item === null || typeof item === "number"));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseAnalyticsSummaryRow2(value: unknown): Array<{ day: string; posts: number; views: number; likes: number }> {
  const valid = (row: unknown): row is Array<{ day: string; posts: number; views: number; likes: number }> =>
    (Array.isArray(row) && row.every((item: unknown) => (isRecord(item) &&
    typeof item.day === "string" &&
    typeof item.posts === "number" &&
    typeof item.views === "number" &&
    typeof item.likes === "number")));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}
