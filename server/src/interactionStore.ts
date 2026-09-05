/**
 * Interacted store — mark engaged threads, 24h author cooldown, and durable
 * history for the Interacted feed. One row per (user, thread) in
 * platform.sqlite `desk_interactions`; every read and write is scoped to a
 * platform user.
 */
import { ensureUserTenant } from "./billingStore.js";
import { getPlatformDb } from "./db.js";
import {
  conversationIdsFromHistory,
  normalizeAuthorKey,
  pruneExpired,
} from "./interactionCooldown.js";

export type InteractionSource = "manual" | "copy" | "discovered";

function normalizeInteractionSource(source: unknown): InteractionSource {
  if (source === "copy" || source === "discovered") return source;
  return "manual";
}

export type ReplyStatSnapshot = {
  views?: number;
  likes?: number;
  replies?: number;
  retweets?: number;
  sampledAt: string;
};

export type InteractionStats = {
  t1h?: ReplyStatSnapshot;
  t24h?: ReplyStatSnapshot;
};

export type Interaction = {
  threadId: string;
  author: string;
  authorKey: string;
  at: string;
  source: InteractionSource;
  /** Platform user who marked this thread — every row belongs to one desk. */
  userId: string;
  url?: string;
  summary?: string;
  text?: string;
  /** Our reply tweet rest id (from pasted reply URL). */
  replyId?: string;
  replyUrl?: string;
  /** When we consider the reply posted; defaults to `at`. */
  postedAt?: string;
  /**
   * X conversation root id (usually the OP status). Used to suppress the whole
   * thread after Mark — not just this reply's author.
   */
  conversationId?: string;
  /** Immediate parent status id when the marked card was a reply. */
  inReplyToId?: string;
  stats?: InteractionStats;
  /** True when the stats → memory note projection soft-failed; retried next tick. */
  memorySyncFailed?: boolean;
  /** True when the mark → gamification ledger projection soft-failed; retried next tick. */
  markGamificationSyncFailed?: boolean;
  /** True when the t24h bonus → gamification ledger projection soft-failed; retried next tick. */
  bonusGamificationSyncFailed?: boolean;
  /** Original mark `at` instances whose gamification projection is pending.
   * A list so a second soft-fail of a re-mark (which overwrites `at`) cannot
   * erase an earlier uncredited mark. */
  pendingMarkAts?: string[];
};

/** Interacted feed / default list cap (newest first). */
export const MAX_INTERACTION_HISTORY = 200;
/**
 * Durable retain for activity windows (28d / 12w). Larger than the feed cap so
 * `GET /api/interacted/stats` can bucket the full window before any count trim.
 */
export const MAX_INTERACTION_STORE = 2000;
const MAX_TEXT_CHARS = 280;

function optionalString(value: unknown, maxLen?: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  if (!t) return undefined;
  if (typeof maxLen === "number" && t.length > maxLen) {
    return t.slice(0, maxLen);
  }
  return t;
}

/** Trim and require a platform user id; desk history never exists unowned. */
export function requireUserId(userId: unknown): string {
  const id = typeof userId === "string" ? userId.trim() : "";
  if (!id) throw new Error("userId is required");
  return id;
}

type InteractionRow = {
  user_id: string;
  thread_id: string;
  author: string;
  author_key: string;
  at: string;
  source: string;
  url: string | null;
  summary: string | null;
  text: string | null;
  reply_id: string | null;
  reply_url: string | null;
  posted_at: string | null;
  conversation_id: string | null;
  in_reply_to_id: string | null;
  stats: string | null;
  memory_sync_failed: number;
  mark_gamification_sync_failed: number;
  bonus_gamification_sync_failed: number;
  pending_mark_ats: string | null;
};

function parseJsonColumn<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function rowToInteraction(row: InteractionRow): Interaction {
  const item: Interaction = {
    threadId: row.thread_id,
    author: row.author,
    authorKey: row.author_key || normalizeAuthorKey(row.author),
    at: row.at,
    source: normalizeInteractionSource(row.source),
    userId: row.user_id,
  };
  if (row.url) item.url = row.url;
  if (row.summary) item.summary = row.summary;
  if (row.text) item.text = row.text;
  if (row.reply_id) item.replyId = row.reply_id;
  if (row.reply_url) item.replyUrl = row.reply_url;
  if (row.posted_at) item.postedAt = row.posted_at;
  if (row.conversation_id) item.conversationId = row.conversation_id;
  if (row.in_reply_to_id) item.inReplyToId = row.in_reply_to_id;
  const stats = parseJsonColumn<InteractionStats>(row.stats);
  if (stats && typeof stats === "object") item.stats = stats;
  if (row.memory_sync_failed) item.memorySyncFailed = true;
  if (row.mark_gamification_sync_failed) item.markGamificationSyncFailed = true;
  if (row.bonus_gamification_sync_failed) {
    item.bonusGamificationSyncFailed = true;
  }
  const pending = parseJsonColumn<unknown>(row.pending_mark_ats);
  if (Array.isArray(pending)) {
    const ats = pending.filter(
      (s): s is string => typeof s === "string" && s.trim() !== "",
    );
    if (ats.length) item.pendingMarkAts = ats;
  }
  return item;
}

const UPSERT_SQL = `INSERT INTO desk_interactions (
    user_id, tenant_id, thread_id, author, author_key, at, source,
    url, summary, text, reply_id, reply_url, posted_at,
    conversation_id, in_reply_to_id, stats,
    memory_sync_failed, mark_gamification_sync_failed,
    bonus_gamification_sync_failed, pending_mark_ats
  ) VALUES (
    @user_id, @tenant_id, @thread_id, @author, @author_key, @at, @source,
    @url, @summary, @text, @reply_id, @reply_url, @posted_at,
    @conversation_id, @in_reply_to_id, @stats,
    @memory_sync_failed, @mark_gamification_sync_failed,
    @bonus_gamification_sync_failed, @pending_mark_ats
  )
  ON CONFLICT (user_id, thread_id) DO UPDATE SET
    tenant_id = excluded.tenant_id,
    author = excluded.author,
    author_key = excluded.author_key,
    at = excluded.at,
    source = excluded.source,
    url = excluded.url,
    summary = excluded.summary,
    text = excluded.text,
    reply_id = excluded.reply_id,
    reply_url = excluded.reply_url,
    posted_at = excluded.posted_at,
    conversation_id = excluded.conversation_id,
    in_reply_to_id = excluded.in_reply_to_id,
    stats = excluded.stats,
    memory_sync_failed = excluded.memory_sync_failed,
    mark_gamification_sync_failed = excluded.mark_gamification_sync_failed,
    bonus_gamification_sync_failed = excluded.bonus_gamification_sync_failed,
    pending_mark_ats = excluded.pending_mark_ats`;

/** Write the full row for (user, thread). Callers hold the merged shape. */
export function writeInteractionRow(
  interaction: Interaction,
  tenantId: string,
): void {
  getPlatformDb()
    .prepare(UPSERT_SQL)
    .run({
      user_id: interaction.userId,
      tenant_id: tenantId,
      thread_id: interaction.threadId,
      author: interaction.author,
      author_key: interaction.authorKey,
      at: interaction.at,
      source: interaction.source,
      url: interaction.url ?? null,
      summary: interaction.summary ?? null,
      text: interaction.text ?? null,
      reply_id: interaction.replyId ?? null,
      reply_url: interaction.replyUrl ?? null,
      posted_at: interaction.postedAt ?? null,
      conversation_id: interaction.conversationId ?? null,
      in_reply_to_id: interaction.inReplyToId ?? null,
      stats: interaction.stats ? JSON.stringify(interaction.stats) : null,
      memory_sync_failed: interaction.memorySyncFailed ? 1 : 0,
      mark_gamification_sync_failed: interaction.markGamificationSyncFailed
        ? 1
        : 0,
      bonus_gamification_sync_failed: interaction.bonusGamificationSyncFailed
        ? 1
        : 0,
      pending_mark_ats: interaction.pendingMarkAts?.length
        ? JSON.stringify(interaction.pendingMarkAts)
        : null,
    });
}

/** One user's row for a thread, or null. */
export function readInteractionRow(
  userId: string,
  threadId: string,
): Interaction | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT * FROM desk_interactions WHERE user_id = ? AND thread_id = ?`,
    )
    .get(userId, threadId) as InteractionRow | undefined;
  return row ? rowToInteraction(row) : null;
}

/** Drop rows past the durable retain for one user (newest first survive). */
function trimUserRows(userId: string, max: number = MAX_INTERACTION_STORE): void {
  getPlatformDb()
    .prepare(
      `DELETE FROM desk_interactions
        WHERE user_id = ? AND thread_id IN (
          SELECT thread_id FROM desk_interactions
           WHERE user_id = ?
           ORDER BY at DESC, thread_id DESC
           LIMIT -1 OFFSET ?
        )`,
    )
    .run(userId, userId, max);
}

/** Newest-first, capped history (no 24h prune). */
export function trimInteractionHistory(
  interactions: Interaction[],
  max: number = MAX_INTERACTION_HISTORY,
): Interaction[] {
  return [...interactions]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, max);
}

/** Upsert by user and threadId; keep durable history (cap); persist. */
export async function markInteracted(opts: {
  threadId: string;
  author: string;
  source?: InteractionSource;
  userId: string;
  url?: string;
  summary?: string;
  text?: string;
  replyId?: string;
  replyUrl?: string;
  postedAt?: string;
  conversationId?: string;
  inReplyToId?: string;
  nowMs?: number;
}): Promise<Interaction> {
  const threadId = opts.threadId.trim();
  const author = opts.author.trim();
  const authorKey = normalizeAuthorKey(author);
  if (!threadId || !author || !authorKey) {
    throw new Error("threadId and author are required");
  }
  const userId = requireUserId(opts.userId);
  const tenantId = ensureUserTenant(userId);
  const nowMs = opts.nowMs ?? Date.now();
  const source = normalizeInteractionSource(opts.source);
  const at = new Date(nowMs).toISOString();
  const next: Interaction = {
    threadId,
    author,
    authorKey,
    at,
    source,
    userId,
  };
  const url = optionalString(opts.url);
  const summary = optionalString(opts.summary);
  const text = optionalString(opts.text, MAX_TEXT_CHARS);
  const replyId = optionalString(opts.replyId);
  const replyUrl = optionalString(opts.replyUrl);
  const postedAt = optionalString(opts.postedAt) ?? at;
  const conversationId = optionalString(opts.conversationId);
  const inReplyToId = optionalString(opts.inReplyToId);
  if (url) next.url = url;
  if (summary) next.summary = summary;
  if (text) next.text = text;
  if (replyId) next.replyId = replyId;
  if (replyUrl) next.replyUrl = replyUrl;
  if (replyId || replyUrl) next.postedAt = postedAt;
  // Prefer explicit conversation root; fall back so ancestry still blocks.
  const root = conversationId || inReplyToId || null;
  if (root) next.conversationId = root;
  if (inReplyToId) next.inReplyToId = inReplyToId;

  const db = getPlatformDb();
  const tx = db.transaction(() => {
    const prior = readInteractionRow(userId, threadId);
    // Preserve existing stats snapshots across re-marks of the same thread.
    if (prior?.stats) next.stats = prior.stats;
    if (prior?.memorySyncFailed) next.memorySyncFailed = true;
    if (prior?.markGamificationSyncFailed) next.markGamificationSyncFailed = true;
    if (prior?.bonusGamificationSyncFailed) {
      next.bonusGamificationSyncFailed = true;
    }
    if (prior?.pendingMarkAts?.length) {
      next.pendingMarkAts = prior.pendingMarkAts;
    }
    if (!next.conversationId && prior?.conversationId) {
      next.conversationId = prior.conversationId;
    }
    if (!next.inReplyToId && prior?.inReplyToId) {
      next.inReplyToId = prior.inReplyToId;
    }
    writeInteractionRow(next, tenantId);
    // Retain enough history for the activity dashboard window; feed UI still
    // lists at MAX_INTERACTION_HISTORY via listInteractionHistory().
    trimUserRows(userId, MAX_INTERACTION_STORE);
  });
  tx();
  return next;
}

/** Interactions still inside the 24h Scout cooldown window. */
export async function listActiveInteractions(opts: {
  nowMs?: number;
  /** Only rows marked by this platform user. */
  userId: string;
}): Promise<Interaction[]> {
  const nowMs = opts.nowMs ?? Date.now();
  const rows = await listInteractionHistory({
    userId: opts.userId,
    limit: MAX_INTERACTION_STORE,
  });
  return pruneExpired(rows, nowMs);
}

/** Durable Interacted feed (newest first, capped). */
export async function listInteractionHistory(opts: {
  limit?: number;
  /** Only rows marked by this platform user. */
  userId: string;
}): Promise<Interaction[]> {
  const userId = requireUserId(opts.userId);
  const limit = Math.max(0, opts.limit ?? MAX_INTERACTION_HISTORY);
  const rows = getPlatformDb()
    .prepare(
      `SELECT * FROM desk_interactions
        WHERE user_id = ?
        ORDER BY at DESC, thread_id DESC
        LIMIT ?`,
    )
    .all(userId, limit) as InteractionRow[];
  return rows.map(rowToInteraction);
}

/**
 * Every user's rows (worker sweeps: stats due queue, projection retries).
 * Newest first, capped per call. Not for desk reads.
 */
export function listAllInteractionRows(opts?: {
  limit?: number | null;
  where?: string;
}): Interaction[] {
  const limit =
    opts?.limit === null
      ? null
      : Math.max(0, opts?.limit ?? MAX_INTERACTION_STORE);
  const where = opts?.where ? `WHERE ${opts.where}` : "";
  const limitClause = limit === null ? "" : " LIMIT ?";
  const rows = getPlatformDb()
    .prepare(
      `SELECT * FROM desk_interactions ${where}
        ORDER BY at DESC, user_id, thread_id
        ${limitClause}`,
    )
    .all(...(limit === null ? [] : [limit])) as InteractionRow[];
  return rows.map(rowToInteraction);
}

export async function getCooledAuthorKeys(opts: {
  nowMs?: number;
  userId: string;
}): Promise<Set<string>> {
  const active = await listActiveInteractions(opts);
  return new Set(active.map((i) => i.authorKey).filter(Boolean));
}

/** Authors from durable history (not pruned with the 24h window). */
export async function getEverInteractedAuthorKeys(opts: {
  userId: string;
}): Promise<Set<string>> {
  const userId = requireUserId(opts.userId);
  const rows = getPlatformDb()
    .prepare(
      `SELECT DISTINCT author_key FROM desk_interactions WHERE user_id = ?`,
    )
    .all(userId) as Array<{ author_key: string }>;
  return new Set(rows.map((r) => r.author_key).filter(Boolean));
}

export async function getEverInteractedConversationIds(opts: {
  userId: string;
}): Promise<Set<string>> {
  const history = await listInteractionHistory({
    userId: opts.userId,
    limit: MAX_INTERACTION_STORE,
  });
  return conversationIdsFromHistory(history);
}

/**
 * Author keys Scout should drop before triage.
 * Always includes 24h cooldown; when dedupeAccounts is on (default), also
 * lifetime keys from interaction history.
 */
export async function getAuthorKeysForScoutFilter(opts: {
  dedupeAccounts?: boolean;
  nowMs?: number;
  userId: string;
}): Promise<Set<string>> {
  const cooled = await getCooledAuthorKeys({
    userId: opts.userId,
    nowMs: opts.nowMs,
  });
  if (opts.dedupeAccounts === false) return cooled;
  const ever = await getEverInteractedAuthorKeys({ userId: opts.userId });
  if (!ever.size) return cooled;
  return new Set([...cooled, ...ever]);
}
