/**
 * Expired cool leads — auto-moved when tweet age ≥ 24h without
 * interact/dismiss. One row per (user, thread) in platform.sqlite
 * `desk_expired`.
 */
import { ensureUserTenant } from "./billingStore.js";
import { getPlatformDb } from "./db.js";
import { normalizeAuthorKey } from "./interactionCooldown.js";
import { requireUserId } from "./interactionStore.js";
import type { ThreadCard } from "./threadCard.js";

export type ExpiredThread = {
  threadId: string;
  author: string;
  authorKey: string;
  /** When we marked it expired. */
  at: string;
  createdAt?: string;
  url?: string;
  summary?: string;
  text?: string;
};

export const EXPIRED_MS = 24 * 60 * 60 * 1000;
export const MAX_EXPIRED_HISTORY = 200;
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

function parseCreatedAtMs(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/**
 * Threads with parseable createdAt older than EXPIRED_MS, not in skipIds.
 */
export function selectStaleThreads(
  threads: ThreadCard[],
  nowMs: number = Date.now(),
  skipIds: Set<string> = new Set(),
  maxAgeMs: number = EXPIRED_MS,
): ThreadCard[] {
  const out: ThreadCard[] = [];
  for (const t of threads) {
    if (!t.id || skipIds.has(t.id)) continue;
    const created = parseCreatedAtMs(t.createdAt);
    if (created === null) continue;
    if (nowMs - created < maxAgeMs) continue;
    out.push(t);
  }
  return out;
}

type ExpiredRow = {
  thread_id: string;
  author: string;
  author_key: string;
  at: string;
  created_at: string | null;
  url: string | null;
  summary: string | null;
  text: string | null;
};

function rowToExpired(row: ExpiredRow): ExpiredThread {
  const item: ExpiredThread = {
    threadId: row.thread_id,
    author: row.author,
    authorKey: row.author_key || normalizeAuthorKey(row.author),
    at: row.at,
  };
  if (row.created_at) item.createdAt = row.created_at;
  if (row.url) item.url = row.url;
  if (row.summary) item.summary = row.summary;
  if (row.text) item.text = row.text;
  return item;
}

export function trimExpiredHistory(
  expired: ExpiredThread[],
  max: number = MAX_EXPIRED_HISTORY,
): ExpiredThread[] {
  return [...expired]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, max);
}

export async function markExpired(opts: {
  threadId: string;
  author: string;
  userId: string;
  createdAt?: string;
  url?: string;
  summary?: string;
  text?: string;
  nowMs?: number;
}): Promise<ExpiredThread> {
  const threadId = opts.threadId.trim();
  const author = opts.author.trim();
  const authorKey = normalizeAuthorKey(author);
  if (!threadId || !author || !authorKey) {
    throw new Error("threadId and author are required");
  }
  const userId = requireUserId(opts.userId);
  const tenantId = ensureUserTenant(userId);
  const nowMs = opts.nowMs ?? Date.now();
  const next: ExpiredThread = {
    threadId,
    author,
    authorKey,
    at: new Date(nowMs).toISOString(),
  };
  const createdAt = optionalString(opts.createdAt);
  const url = optionalString(opts.url);
  const summary = optionalString(opts.summary);
  const text = optionalString(opts.text, MAX_TEXT_CHARS);
  if (createdAt) next.createdAt = createdAt;
  if (url) next.url = url;
  if (summary) next.summary = summary;
  if (text) next.text = text;

  const db = getPlatformDb();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO desk_expired (
          user_id, tenant_id, thread_id, author, author_key, at,
          created_at, url, summary, text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, thread_id) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          author = excluded.author,
          author_key = excluded.author_key,
          at = excluded.at,
          created_at = excluded.created_at,
          url = excluded.url,
          summary = excluded.summary,
          text = excluded.text`,
    ).run(
      userId,
      tenantId,
      threadId,
      author,
      authorKey,
      next.at,
      next.createdAt ?? null,
      next.url ?? null,
      next.summary ?? null,
      next.text ?? null,
    );
    db.prepare(
      `DELETE FROM desk_expired
        WHERE user_id = ? AND thread_id IN (
          SELECT thread_id FROM desk_expired
           WHERE user_id = ?
           ORDER BY at DESC, thread_id DESC
           LIMIT -1 OFFSET ?
        )`,
    ).run(userId, userId, MAX_EXPIRED_HISTORY);
  })();
  return next;
}

export async function listExpiredHistory(opts: {
  userId: string;
  limit?: number;
}): Promise<ExpiredThread[]> {
  const userId = requireUserId(opts.userId);
  const rows = getPlatformDb()
    .prepare(
      `SELECT thread_id, author, author_key, at, created_at, url, summary, text
         FROM desk_expired
        WHERE user_id = ?
        ORDER BY at DESC, thread_id DESC
        LIMIT ?`,
    )
    .all(userId, Math.max(0, opts.limit ?? MAX_EXPIRED_HISTORY)) as ExpiredRow[];
  return rows.map(rowToExpired);
}

export async function getExpiredThreadIds(opts: {
  userId: string;
}): Promise<Set<string>> {
  const history = await listExpiredHistory(opts);
  return new Set(history.map((d) => d.threadId).filter(Boolean));
}
