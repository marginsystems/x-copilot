/**
 * Voice profile persistence: the user's own public posts, the learned
 * style card, and the UTC-day suggest ledger. Their writing only — other
 * people's feeds are never stored here.
 */
import { randomUUID } from "node:crypto";
import { getPlatformDb } from "./db.js";
import { startOfUtcDayIso } from "./ownPostStore.js";
import { PLAN_DAILY_SUGGESTS, type PlanKey } from "./plans.js";

/** Suggest unlocks after this many of their public posts in the corpus. */
export const VOICE_UNLOCK_MIN_POSTS = 100;

/** @deprecated Use VOICE_UNLOCK_MIN_POSTS. */
export const VOICE_UNLOCK_MIN_CONVERSATIONS = VOICE_UNLOCK_MIN_POSTS;

export type VoiceProfileStatus = "empty" | "learning" | "ready";

export type VoiceReplyInput = {
  id: string;
  text: string;
  conversationId?: string | null;
  inReplyToId?: string | null;
  postedAt?: string | null;
  source?: "api" | "desk" | "memory";
};

export type VoiceReplyRow = {
  id: string;
  text: string;
  conversationId: string | null;
  postedAt: string | null;
  source: string;
};

export type VoiceProfileRow = {
  userId: string;
  tenantId: string;
  xUsername: string | null;
  xUserId: string | null;
  status: VoiceProfileStatus;
  replyCount: number;
  conversationCount: number;
  cardJson: string | null;
  cardModel: string | null;
  cardUpdatedAt: string | null;
  cardAttemptAt: string | null;
  sinceId: string | null;
  lastPullAt: string | null;
  lastError: string | null;
};

export function voiceUnlocked(postCount: number): boolean {
  return postCount >= VOICE_UNLOCK_MIN_POSTS;
}

/** Hourly ingest rewrites the card at most this often (also once per UTC day). */
export const VOICE_CARD_REFRESH_MS = 24 * 60 * 60 * 1000;

export function voiceCardStale(
  cardUpdatedAt: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!cardUpdatedAt) return true;
  const t = Date.parse(cardUpdatedAt);
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= VOICE_CARD_REFRESH_MS;
}

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
  const row = getPlatformDb()
    .prepare(
      `SELECT user_id, tenant_id, x_username, x_user_id, status, reply_count,
              conversation_count, card_json, card_model, card_updated_at,
              card_attempt_at, since_id, last_pull_at, last_error
       FROM voice_profiles WHERE user_id = ?`,
    )
    .get(userId) as
    | {
        user_id: string;
        tenant_id: string;
        x_username: string | null;
        x_user_id: string | null;
        status: string;
        reply_count: number;
        conversation_count: number;
        card_json: string | null;
        card_model: string | null;
        card_updated_at: string | null;
        card_attempt_at: string | null;
        since_id: string | null;
        last_pull_at: string | null;
        last_error: string | null;
      }
    | undefined;
  if (!row) return null;
  const status: VoiceProfileStatus =
    row.status === "ready" || row.status === "learning" ? row.status : "empty";
  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    xUsername: row.x_username,
    xUserId: row.x_user_id,
    status,
    replyCount: Number(row.reply_count) || 0,
    conversationCount: Number(row.conversation_count) || 0,
    cardJson: row.card_json,
    cardModel: row.card_model,
    cardUpdatedAt: row.card_updated_at,
    cardAttemptAt: row.card_attempt_at,
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
  const row = getPlatformDb()
    .prepare(`SELECT COUNT(*) AS n FROM voice_replies WHERE user_id = ?`)
    .get(userId) as { n: number };
  return Number(row?.n ?? 0);
}

/**
 * Distinct conversations among stored posts. Posts without a
 * conversation id fall back to their own post id.
 */
export function countDistinctConversations(userId: string): number {
  const row = getPlatformDb()
    .prepare(
      `SELECT COUNT(DISTINCT COALESCE(conversation_id, id)) AS n
       FROM voice_replies WHERE user_id = ?`,
    )
    .get(userId) as { n: number };
  return Number(row?.n ?? 0);
}

export function listVoiceReplies(
  userId: string,
  limit = 100,
): VoiceReplyRow[] {
  const rows = getPlatformDb()
    .prepare(
      `SELECT id, text, conversation_id, posted_at, source
       FROM voice_replies WHERE user_id = ?
       ORDER BY posted_at DESC, id DESC LIMIT ?`,
    )
    .all(userId, Math.min(Math.max(limit, 1), 200)) as Array<{
    id: string;
    text: string;
    conversation_id: string | null;
    posted_at: string | null;
    source: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    conversationId: r.conversation_id,
    postedAt: r.posted_at,
    source: r.source,
  }));
}

/**
 * Fold the user's own posts the desk already detected (Activity API own_posts)
 * into the voice corpus — free, local-only, keeps the card current between API
 * pulls. Originals, replies, and quotes all count; retweets do not.
 */
export function foldDeskReplies(userId: string): number {
  const rows = getPlatformDb()
    .prepare(
      `SELECT id, text, conversation_id, in_reply_to_id, posted_at
       FROM own_posts
       WHERE user_id = ? AND kind != 'repost' AND text IS NOT NULL AND text != ''`,
    )
    .all(userId) as Array<{
    id: string;
    text: string;
    conversation_id: string | null;
    in_reply_to_id: string | null;
    posted_at: string | null;
  }>;
  if (!rows.length) return 0;
  return upsertVoiceReplies(
    userId,
    rows.map((r) => ({
      id: r.id,
      text: r.text,
      conversationId: r.conversation_id,
      inReplyToId: r.in_reply_to_id,
      postedAt: r.posted_at,
      source: "desk" as const,
    })),
  );
}

/** Fold replies already sitting in interacted memories (no X API). */
export function foldMemoryReplies(
  userId: string,
  replies: VoiceReplyInput[],
): number {
  if (!replies.length) return 0;
  return upsertVoiceReplies(
    userId,
    replies.map((r) => ({
      ...r,
      source: "memory",
    })),
  );
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
         status = 'empty',
         reply_count = 0,
         conversation_count = 0,
         card_json = NULL,
         card_model = NULL,
         card_updated_at = NULL,
         card_attempt_at = NULL,
         since_id = NULL,
         last_error = NULL,
         updated_at = ?
       WHERE user_id = ?`,
    ).run(nowIso(), userId);
  })();
}

/** Recompute stored reply/conversation counts without touching pull cursors. */
export function refreshVoiceCounts(userId: string): void {
  getPlatformDb()
    .prepare(
      `UPDATE voice_profiles SET reply_count = ?, conversation_count = ?, updated_at = ?
       WHERE user_id = ?`,
    )
    .run(
      countVoiceReplies(userId),
      countDistinctConversations(userId),
      nowIso(),
      userId,
    );
}

export function setVoiceProfileStatus(
  userId: string,
  status: VoiceProfileStatus,
  lastError?: string | null,
): void {
  getPlatformDb()
    .prepare(
      `UPDATE voice_profiles SET status = ?, last_error = ?, updated_at = ?
       WHERE user_id = ?`,
    )
    .run(status, lastError ?? null, nowIso(), userId);
}

export function updateVoiceProfilePull(input: {
  userId: string;
  xUsername: string | null;
  xUserId?: string | null;
  sinceId?: string | null;
  lastPullAt?: string | null;
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
         last_error = NULL,
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
      nowIso(),
      input.userId,
    );
}

export function saveVoiceCard(input: {
  userId: string;
  cardJson: string;
  model: string;
}): void {
  const at = nowIso();
  getPlatformDb()
    .prepare(
      `UPDATE voice_profiles SET
         card_json = ?, card_model = ?, card_updated_at = ?, card_attempt_at = ?,
         status = 'ready', last_error = NULL, updated_at = ?
       WHERE user_id = ?`,
    )
    .run(input.cardJson, input.model, at, at, at, input.userId);
}

/**
 * Stamp the last card rewrite attempt (success or failure) so the hourly
 * refresh gate caps generation at once per UTC day even when the LLM fails.
 * `card_updated_at` still records only successful writes.
 */
export function stampVoiceCardAttempt(userId: string): void {
  const at = nowIso();
  getPlatformDb()
    .prepare(
      `UPDATE voice_profiles SET card_attempt_at = ?, updated_at = ?
       WHERE user_id = ?`,
    )
    .run(at, at, userId);
}

// --- Daily suggest cap (UTC day, generations only — verifies are free) ---

export function suggestLimitForPlan(plan: PlanKey): number {
  return PLAN_DAILY_SUGGESTS[plan];
}

export function countSuggestsToday(userId: string, now = new Date()): number {
  const row = getPlatformDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM voice_suggests WHERE user_id = ? AND at >= ?`,
    )
    .get(userId, startOfUtcDayIso(now)) as { n: number };
  return Number(row?.n ?? 0);
}

export function recordSuggest(
  userId: string,
  threadId?: string,
  at = new Date().toISOString(),
): string {
  const id = randomUUID();
  getPlatformDb()
    .prepare(
      `INSERT INTO voice_suggests (id, user_id, thread_id, at) VALUES (?, ?, ?, ?)`,
    )
    .run(id, userId, threadId ?? null, at);
  return id;
}

/**
 * Atomically reserve a daily suggest slot: the count and the insert run in a
 * single transaction, so concurrent suggests cannot both pass the cap check
 * before either one records. Returns the reserved row id, or null when the
 * day's cap is already reached.
 */
export function reserveSuggestSlot(
  userId: string,
  limit: number,
  threadId?: string,
  now = new Date(),
): string | null {
  return getPlatformDb().transaction(() => {
    if (countSuggestsToday(userId, now) >= limit) return null;
    return recordSuggest(userId, threadId, now.toISOString());
  })();
}

export function removeSuggestRecord(id: string): void {
  getPlatformDb().prepare(`DELETE FROM voice_suggests WHERE id = ?`).run(id);
}

export type SuggestUsage = {
  used: number;
  limit: number;
  remaining: number;
  canSuggest: boolean;
  planKey: PlanKey;
};

export function getSuggestUsage(
  userId: string,
  planKey: PlanKey,
  now = new Date(),
): SuggestUsage {
  const used = countSuggestsToday(userId, now);
  const limit = suggestLimitForPlan(planKey);
  const remaining = Math.max(0, limit - used);
  return { used, limit, remaining, canSuggest: remaining > 0, planKey };
}
