import { stringRow, objectValue } from "../platform/unknownValue.js";
import { getPlatformDb } from "../db.js";

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
    .all(userId, sinceIso).map((row) => stringRow(row, "tweetId", "createdAt"));
  return rows;
}

/** Confirmed desk-published originals (empty in_reply_to_id) today. */
export function countDeskOriginalsSince(
  userId: string,
  sinceIso: string,
): number {
  const row = objectValue(
    getPlatformDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM x_desk_posts
          WHERE user_id = ? AND created_at >= ?
            AND in_reply_to_id = ? AND tweet_id != ?`,
      )
      .get(userId, sinceIso, "", ""),
  );
  return Number(row.n) || 0;
}

export function listDeskOriginalsSince(
  userId: string,
  sinceIso: string,
): Array<{ tweetId: string; createdAt: string }> {
  const rows = getPlatformDb()
    .prepare(
      `SELECT tweet_id AS tweetId, created_at AS createdAt FROM x_desk_posts
        WHERE user_id = ? AND created_at >= ?
          AND in_reply_to_id = ? AND tweet_id != ?
        ORDER BY created_at DESC LIMIT 2000`,
    )
    .all(userId, sinceIso, "", "").map((row) => stringRow(row, "tweetId", "createdAt"));
  return rows;
}
