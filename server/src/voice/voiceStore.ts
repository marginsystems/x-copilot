import { isRecord, hasStrings, hasNullableStrings } from "../platform/unknownValue.js";
import { getPlatformDb } from "../db.js";

export type VoiceReplyInput = {
  id: string;
  text: string;
  conversationId?: string | null;
  inReplyToId?: string | null;
  postedAt?: string | null;
  source?: "api" | "desk" | "memory";
  kind?: "original" | "reply" | "quote" | "repost";
};

export type VoiceProfileRow = {
  userId: string;
  tenantId: string;
  xUsername: string | null;
  xUserId: string | null;
  replyCount: number;
  conversationCount: number;
  sinceId: string | null;
  lastPullAt: string | null;
  lastError: string | null;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function ensureVoiceProfile(
  userId: string,
  tenantId: string,
): VoiceProfileRow {
  const at = nowIso();
  getPlatformDb()
    .prepare(
      `INSERT INTO voice_profiles (user_id, tenant_id, status, created_at, updated_at)
       VALUES (?, ?, 'empty', ?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
    )
    .run(userId, tenantId, at, at);
  const row = getVoiceProfile(userId);
  if (!row) throw new Error("voice_profile_missing");
  return row;
}

export function getVoiceProfile(userId: string): VoiceProfileRow | null {
  const row = readVoiceProfileRowOrUndefined(getPlatformDb()
    .prepare(
      `SELECT user_id, tenant_id, x_username, x_user_id, reply_count,
              conversation_count, since_id, last_pull_at, last_error
       FROM voice_profiles WHERE user_id = ?`,
    )
    .get(userId));
  if (!row) return null;
  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    xUsername: row.x_username,
    xUserId: row.x_user_id,
    replyCount: Number(row.reply_count) || 0,
    conversationCount: Number(row.conversation_count) || 0,
    sinceId: row.since_id,
    lastPullAt: row.last_pull_at,
    lastError: row.last_error,
  };
}

/** Insert-or-refresh the user's own replies. Returns how many were new. */
export function upsertVoiceReplies(
  userId: string,
  replies: VoiceReplyInput[],
): number {
  if (!replies.length) return 0;
  const db = getPlatformDb();
  const at = nowIso();
  const stmt = db.prepare(
    `INSERT INTO voice_replies
       (user_id, id, conversation_id, in_reply_to_id, text, posted_at, source, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, id) DO UPDATE SET
       text = excluded.text,
       conversation_id = COALESCE(excluded.conversation_id, voice_replies.conversation_id)`,
  );
  const before = countVoiceReplies(userId);
  const tx = db.transaction(() => {
    for (const reply of replies) {
      const id = reply.id.trim();
      const text = reply.text.trim();
      if (!id || !text) continue;
      stmt.run(
        userId,
        id,
        reply.conversationId?.trim() || null,
        reply.inReplyToId?.trim() || null,
        text,
        reply.postedAt ?? null,
        reply.source ?? "api",
        at,
      );
    }
  });
  tx();
  return countVoiceReplies(userId) - before;
}

export function countVoiceReplies(userId: string): number {
  const row = readVoiceCountRow(getPlatformDb()
    .prepare(`SELECT COUNT(*) AS n FROM voice_replies WHERE user_id = ?`)
    .get(userId));
  return Number(row?.n ?? 0);
}

/**
 * Distinct conversations among stored posts. Posts without a
 * conversation id fall back to their own post id.
 */
export function countDistinctConversations(userId: string): number {
  const row = readVoiceCountRow(getPlatformDb()
    .prepare(
      `SELECT COUNT(DISTINCT COALESCE(conversation_id, id)) AS n
       FROM voice_replies WHERE user_id = ?`,
    )
    .get(userId));
  return Number(row?.n ?? 0);
}

/**
 * Drop the user's whole voice corpus (own replies + folded own_posts) and
 * reset the profile, so switching the public X handle starts the corpus fresh
 * instead of blending the previous account's data into the new one. The
 * own_posts delete is scoped to the previous account's rows (they carry
 * x_user_id) so it never touches posts belonging to another already-ingested
 * account.
 */
export function resetUserVoiceCorpus(
  userId: string,
  oldXUserId?: string | null,
): void {
  const db = getPlatformDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM voice_replies WHERE user_id = ?`).run(userId);
    if (oldXUserId) {
      db.prepare(
        `DELETE FROM own_posts WHERE user_id = ? AND x_user_id = ?`,
      ).run(userId, oldXUserId);
    } else {
      db.prepare(`DELETE FROM own_posts WHERE user_id = ?`).run(userId);
    }
    db.prepare(
      `UPDATE voice_profiles SET
         x_username = NULL,
         x_user_id = NULL,
         reply_count = 0,
         conversation_count = 0,
         since_id = NULL,
         last_error = NULL,
         updated_at = ?
       WHERE user_id = ?`,
    ).run(nowIso(), userId);
  })();
}

export function updateVoiceProfilePull(input: {
  userId: string;
  xUsername: string | null;
  xUserId?: string | null;
  sinceId?: string | null;
  lastPullAt?: string | null;
  lastError?: string | null;
}): void {
  const replyCount = countVoiceReplies(input.userId);
  const conversationCount = countDistinctConversations(input.userId);
  getPlatformDb()
    .prepare(
      `UPDATE voice_profiles SET
         x_username = ?,
         x_user_id = COALESCE(?, x_user_id),
         since_id = COALESCE(?, since_id),
         reply_count = ?,
         conversation_count = ?,
         last_pull_at = COALESCE(?, last_pull_at),
         last_error = ?,
         updated_at = ?
       WHERE user_id = ?`,
    )
    .run(
      input.xUsername,
      input.xUserId ?? null,
      input.sinceId ?? null,
      replyCount,
      conversationCount,
      input.lastPullAt ?? null,
      input.lastError ?? null,
      nowIso(),
      input.userId,
    );
}

function readVoiceProfileRow(value: unknown) {
  if (!(
    isRecord(value) &&
    hasStrings(value, "user_id", "tenant_id") &&
    hasNullableStrings(value, "x_username", "x_user_id", "since_id", "last_pull_at", "last_error") &&
    ("reply_count" in value && typeof value.reply_count === "number") &&
    ("conversation_count" in value && typeof value.conversation_count === "number")
  )) throw new TypeError("Invalid database row");
  return {
    user_id: value.user_id,
    tenant_id: value.tenant_id,
    x_username: value.x_username,
    x_user_id: value.x_user_id,
    reply_count: value.reply_count,
    conversation_count: value.conversation_count,
    since_id: value.since_id,
    last_pull_at: value.last_pull_at,
    last_error: value.last_error,
  };
}

function readVoiceProfileRowOrUndefined(value: unknown) {
  return value === undefined ? undefined : readVoiceProfileRow(value);
}

function readVoiceCountRow(value: unknown) {
  if (!(
    isRecord(value) &&
    ("n" in value && typeof value.n === "number")
  )) throw new TypeError("Invalid database row");
  return {
    n: value.n,
  };
}
