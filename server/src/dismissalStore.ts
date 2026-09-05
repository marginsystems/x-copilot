/**
 * Dismissals — "not interested" curated leads.
 * One row per (user, thread) in platform.sqlite `desk_dismissals`.
 */
import { ensureUserTenant } from "./billingStore.js";
import { getPlatformDb } from "./db.js";
import {
  getEverInteractedConversationIds,
  requireUserId,
} from "./interactionStore.js";
import {
  conversationIdsFromHistory,
  normalizeAuthorKey,
} from "./interactionCooldown.js";

export type Dismissal = {
  threadId: string;
  author: string;
  authorKey: string;
  at: string;
  url?: string;
  summary?: string;
  text?: string;
  reason?: string;
  /** X conversation root — blocks sibling replies on later Scouts. */
  conversationId?: string;
  /** Immediate parent status id when the dismissed card was a reply. */
  inReplyToId?: string;
};

export const MAX_DISMISSAL_HISTORY = 200;
const MAX_TEXT_CHARS = 280;
const MAX_REASON_CHARS = 500;

function optionalString(value: unknown, maxLen?: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  if (!t) return undefined;
  if (typeof maxLen === "number" && t.length > maxLen) {
    return t.slice(0, maxLen);
  }
  return t;
}

type DismissalRow = {
  thread_id: string;
  author: string;
  author_key: string;
  at: string;
  url: string | null;
  summary: string | null;
  text: string | null;
  reason: string | null;
  conversation_id: string | null;
  in_reply_to_id: string | null;
};

function rowToDismissal(row: DismissalRow): Dismissal {
  const item: Dismissal = {
    threadId: row.thread_id,
    author: row.author,
    authorKey: row.author_key || normalizeAuthorKey(row.author),
    at: row.at,
  };
  if (row.url) item.url = row.url;
  if (row.summary) item.summary = row.summary;
  if (row.text) item.text = row.text;
  if (row.reason) item.reason = row.reason;
  // Prefer explicit conversation root; fall back so ancestry still blocks.
  const root = row.conversation_id || row.in_reply_to_id || null;
  if (root) item.conversationId = root;
  if (row.in_reply_to_id) item.inReplyToId = row.in_reply_to_id;
  return item;
}

function readDismissalRow(userId: string, threadId: string): Dismissal | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT thread_id, author, author_key, at, url, summary, text, reason,
              conversation_id, in_reply_to_id
         FROM desk_dismissals
        WHERE user_id = ? AND thread_id = ?`,
    )
    .get(userId, threadId) as DismissalRow | undefined;
  return row ? rowToDismissal(row) : null;
}

export function trimDismissalHistory(
  dismissals: Dismissal[],
  max: number = MAX_DISMISSAL_HISTORY,
): Dismissal[] {
  return [...dismissals]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, max);
}

export async function markDismissed(opts: {
  threadId: string;
  author: string;
  userId: string;
  url?: string;
  summary?: string;
  text?: string;
  reason?: string;
  conversationId?: string;
  inReplyToId?: string;
  nowMs?: number;
}): Promise<Dismissal> {
  const threadId = opts.threadId.trim();
  const author = opts.author.trim();
  const authorKey = normalizeAuthorKey(author);
  if (!threadId || !author || !authorKey) {
    throw new Error("threadId and author are required");
  }
  const userId = requireUserId(opts.userId);
  const tenantId = ensureUserTenant(userId);
  const nowMs = opts.nowMs ?? Date.now();
  const next: Dismissal = {
    threadId,
    author,
    authorKey,
    at: new Date(nowMs).toISOString(),
  };
  const url = optionalString(opts.url);
  const summary = optionalString(opts.summary);
  const text = optionalString(opts.text, MAX_TEXT_CHARS);
  const reason = optionalString(opts.reason, MAX_REASON_CHARS);
  const conversationId = optionalString(opts.conversationId);
  const inReplyToId = optionalString(opts.inReplyToId);
  if (url) next.url = url;
  if (summary) next.summary = summary;
  if (text) next.text = text;
  if (reason) next.reason = reason;
  const root = conversationId || inReplyToId || null;
  if (root) next.conversationId = root;
  if (inReplyToId) next.inReplyToId = inReplyToId;

  const db = getPlatformDb();
  db.transaction(() => {
    const prior = readDismissalRow(userId, threadId);
    if (!next.conversationId && prior?.conversationId) {
      next.conversationId = prior.conversationId;
    }
    if (!next.inReplyToId && prior?.inReplyToId) {
      next.inReplyToId = prior.inReplyToId;
    }
    db.prepare(
      `INSERT INTO desk_dismissals (
          user_id, tenant_id, thread_id, author, author_key, at,
          url, summary, text, reason, conversation_id, in_reply_to_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, thread_id) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          author = excluded.author,
          author_key = excluded.author_key,
          at = excluded.at,
          url = excluded.url,
          summary = excluded.summary,
          text = excluded.text,
          reason = excluded.reason,
          conversation_id = excluded.conversation_id,
          in_reply_to_id = excluded.in_reply_to_id`,
    ).run(
      userId,
      tenantId,
      threadId,
      author,
      authorKey,
      next.at,
      next.url ?? null,
      next.summary ?? null,
      next.text ?? null,
      next.reason ?? null,
      next.conversationId ?? null,
      next.inReplyToId ?? null,
    );
    db.prepare(
      `DELETE FROM desk_dismissals
        WHERE user_id = ? AND thread_id IN (
          SELECT thread_id FROM desk_dismissals
           WHERE user_id = ?
           ORDER BY at DESC, thread_id DESC
           LIMIT -1 OFFSET ?
        )`,
    ).run(userId, userId, MAX_DISMISSAL_HISTORY);
  })();
  return next;
}

export async function listDismissalHistory(opts: {
  userId: string;
  limit?: number;
}): Promise<Dismissal[]> {
  const userId = requireUserId(opts.userId);
  const rows = getPlatformDb()
    .prepare(
      `SELECT thread_id, author, author_key, at, url, summary, text, reason,
              conversation_id, in_reply_to_id
         FROM desk_dismissals
        WHERE user_id = ?
        ORDER BY at DESC, thread_id DESC
        LIMIT ?`,
    )
    .all(
      userId,
      Math.max(0, opts.limit ?? MAX_DISMISSAL_HISTORY),
    ) as DismissalRow[];
  return rows.map(rowToDismissal);
}

/** Conversation / ancestry ids from durable Not interested history. */
export async function getDismissedConversationIds(opts: {
  userId: string;
}): Promise<Set<string>> {
  const history = await listDismissalHistory({
    userId: opts.userId,
    limit: MAX_DISMISSAL_HISTORY,
  });
  return conversationIdsFromHistory(history);
}

/**
 * Union of one user's Marked + Not interested conversation ancestry for
 * Scout filters.
 */
export async function getBlockedConversationIds(opts: {
  userId: string;
}): Promise<Set<string>> {
  const [interacted, dismissed] = await Promise.all([
    getEverInteractedConversationIds({ userId: opts.userId }),
    getDismissedConversationIds({ userId: opts.userId }),
  ]);
  if (!dismissed.size) return interacted;
  if (!interacted.size) return dismissed;
  return new Set([...interacted, ...dismissed]);
}

export async function getDismissedThreadIds(opts: {
  userId: string;
}): Promise<Set<string>> {
  const history = await listDismissalHistory(opts);
  return new Set(history.map((d) => d.threadId).filter(Boolean));
}
