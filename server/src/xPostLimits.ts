/**
 * Desk-post rate limits for the operator's own account.
 * Cooldown + UTC-day cap that grows with level / streak.
 */
import { randomUUID } from "node:crypto";
import { getPlatformDb } from "./db.js";

export const POST_COOLDOWN_MS = 3 * 60 * 1000;
export const POST_DAILY_CAP_MAX = 20;
export const POST_DAILY_CAP_MIN = 5;

export function utcDayStartMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function dailyPostCap(opts: {
  level: number;
  currentStreak: number;
}): number {
  const level = Math.max(1, Math.floor(opts.level));
  const streak = Math.max(0, Math.floor(opts.currentStreak));
  const base = POST_DAILY_CAP_MIN + Math.floor((level - 1) / 2);
  const streakBonus = streak >= 7 ? 2 : streak >= 3 ? 1 : 0;
  return Math.min(POST_DAILY_CAP_MAX, base + streakBonus);
}

export function listDeskPostsSince(
  userId: string,
  sinceIso: string,
): Array<{ tweetId: string; createdAt: string }> {
  const rows = getPlatformDb()
    .prepare(
      `SELECT tweet_id AS tweetId, created_at AS createdAt
         FROM x_desk_posts
        WHERE user_id = ? AND created_at >= ?
        ORDER BY created_at DESC`,
    )
    .all(userId, sinceIso) as Array<{ tweetId: string; createdAt: string }>;
  return rows;
}

export function recordDeskPost(opts: {
  userId: string;
  tweetId: string;
  inReplyToId: string;
  threadId?: string;
  requestKey?: string;
  atIso?: string;
}): void {
  getPlatformDb()
    .prepare(
      `INSERT INTO x_desk_posts
         (id, user_id, tweet_id, in_reply_to_id, thread_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      // The client-generated idempotency key doubles as the row id so a lost
      // response can be replayed (findDeskPostByKey) without posting twice.
      opts.requestKey || randomUUID(),
      opts.userId,
      opts.tweetId,
      opts.inReplyToId,
      opts.threadId ?? null,
      opts.atIso ?? new Date().toISOString(),
    );
}

/** Replay lookup for a client-generated idempotency key. */
export function findDeskPostByKey(
  userId: string,
  requestKey: string,
): { tweetId: string } | undefined {
  const row = getPlatformDb()
    .prepare(
      `SELECT tweet_id AS tweetId
         FROM x_desk_posts
        WHERE user_id = ? AND id = ?`,
    )
    .get(userId, requestKey) as { tweetId: string } | undefined;
  return row;
}

export type PostLimitBlock =
  | { ok: true; remainingToday: number; cap: number }
  | {
      ok: false;
      error: "cooldown" | "daily_cap";
      retryAfterSec: number;
      remainingToday: number;
      cap: number;
      message: string;
    };

export function checkDeskPostLimit(opts: {
  userId: string;
  level: number;
  currentStreak: number;
  nowMs?: number;
}): PostLimitBlock {
  const nowMs = opts.nowMs ?? Date.now();
  const cap = dailyPostCap({
    level: opts.level,
    currentStreak: opts.currentStreak,
  });
  const dayStart = new Date(utcDayStartMs(nowMs)).toISOString();
  const today = listDeskPostsSince(opts.userId, dayStart);
  const remainingToday = Math.max(0, cap - today.length);
  if (today.length >= cap) {
    const nextDay = utcDayStartMs(nowMs) + 24 * 60 * 60 * 1000;
    const retryAfterSec = Math.max(1, Math.ceil((nextDay - nowMs) / 1000));
    return {
      ok: false,
      error: "daily_cap",
      retryAfterSec,
      remainingToday: 0,
      cap,
      message: `Daily desk-post cap (${cap}) reached. Next window after 00:00 UTC.`,
    };
  }
  // The cooldown is not tied to the UTC day: a post from the last minutes of
  // the previous day must still block the next one across the day boundary.
  const latestRow = getPlatformDb()
    .prepare(
      `SELECT created_at AS createdAt
         FROM x_desk_posts
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get(opts.userId) as { createdAt: string } | undefined;
  if (latestRow) {
    const lastMs = Date.parse(latestRow.createdAt);
    if (Number.isFinite(lastMs) && nowMs - lastMs < POST_COOLDOWN_MS) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((POST_COOLDOWN_MS - (nowMs - lastMs)) / 1000),
      );
      return {
        ok: false,
        error: "cooldown",
        retryAfterSec,
        remainingToday,
        cap,
        message: `Wait ${retryAfterSec}s before the next desk post.`,
      };
    }
  }
  return { ok: true, remainingToday, cap };
}
