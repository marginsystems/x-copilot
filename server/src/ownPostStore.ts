/**
 * Durable own-post ingest + watch list for Activity API post.create.
 */
import { getPlatformDb } from "./db.js";
import type { ActivityMetrics, OwnPostKind, ParsedPostCreate } from "./xActivity.js";
import { postUrl } from "./xActivity.js";

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
  const row = getPlatformDb()
    .prepare(`SELECT event_uuid FROM activity_event_ids WHERE event_uuid = ?`)
    .get(eventUuid) as { event_uuid: string } | undefined;
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

export function countOwnPostsSince(
  userId: string,
  sinceIso: string,
): number {
  const row = getPlatformDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM own_posts WHERE user_id = ? AND posted_at >= ?`,
    )
    .get(userId, sinceIso) as { n: number };
  return Number(row?.n ?? 0);
}

export function upsertOwnPost(input: {
  parsed: ParsedPostCreate;
  userId: string;
  tenantId: string;
}): boolean {
  const db = getPlatformDb();
  const existing = db
    .prepare(`SELECT id FROM own_posts WHERE id = ?`)
    .get(input.parsed.postId) as { id: string } | undefined;
  const url = postUrl(input.parsed.authorUsername, input.parsed.postId);
  const m = input.parsed.metrics;
  const now = new Date().toISOString();
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
       posted_at = excluded.posted_at`,
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
  );
  return !existing;
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
  const rows = getPlatformDb()
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
    .all(t1hBefore, t24hBefore, limit, limit * 2) as Array<{
    id: string;
    user_id: string;
    tenant_id: string;
    posted_at: string;
    t1h_at: string | null;
    t24h_at: string | null;
  }>;
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
  const row = getPlatformDb()
    .prepare(
      `SELECT thread_id, author, url, text, conversation_id
       FROM watched_threads WHERE user_id = ? AND thread_id = ?`,
    )
    .get(userId, threadId) as
    | {
        thread_id: string;
        author: string | null;
        url: string | null;
        text: string | null;
        conversation_id: string | null;
      }
    | undefined;
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
  const rows = getPlatformDb()
    .prepare(
      `SELECT * FROM own_posts WHERE user_id = ? ORDER BY posted_at DESC LIMIT ?`,
    )
    .all(opts.userId, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    tenantId: String(row.tenant_id),
    xUserId: String(row.x_user_id),
    kind: row.kind as OwnPostKind,
    text: (row.text as string | null) ?? null,
    postedAt: String(row.posted_at),
    inReplyToId: (row.in_reply_to_id as string | null) ?? null,
    url: (row.url as string | null) ?? null,
    views: pickLatest(
      row.t24h_views as number | null,
      row.t1h_views as number | null,
      row.t0_views as number | null,
    ),
    likes: pickLatest(
      row.t24h_likes as number | null,
      row.t1h_likes as number | null,
      row.t0_likes as number | null,
    ),
    replies: pickLatest(
      row.t24h_replies as number | null,
      row.t1h_replies as number | null,
      row.t0_replies as number | null,
    ),
    retweets: pickLatest(
      row.t24h_retweets as number | null,
      row.t1h_retweets as number | null,
      row.t0_retweets as number | null,
    ),
    bookmarks: pickLatest(
      row.t24h_bookmarks as number | null,
      row.t1h_bookmarks as number | null,
      row.t0_bookmarks as number | null,
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
  const totalsRow = db
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
    .get(userId) as Record<string, number>;
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
  const dayRows = db
    .prepare(
      `SELECT substr(posted_at, 1, 10) AS day,
         COUNT(*) AS posts,
         COALESCE(SUM(COALESCE(t24h_views, t1h_views, t0_views, 0)), 0) AS views,
         COALESCE(SUM(COALESCE(t24h_likes, t1h_likes, t0_likes, 0)), 0) AS likes
       FROM own_posts WHERE user_id = ?
       GROUP BY day ORDER BY day ASC`,
    )
    .all(userId) as Array<{ day: string; posts: number; views: number; likes: number }>;
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
