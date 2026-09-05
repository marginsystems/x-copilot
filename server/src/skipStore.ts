/**
 * Skips — "pass on this thread" without dismissal memory.
 * One row per (user, thread) in platform.sqlite `desk_skips`.
 */
import { ensureUserTenant } from "./billingStore.js";
import { getPlatformDb } from "./db.js";
import { normalizeAuthorKey } from "./interactionCooldown.js";
import { requireUserId } from "./interactionStore.js";

export type Skip = {
  threadId: string;
  author: string;
  authorKey: string;
  at: string;
  url?: string;
  summary?: string;
  text?: string;
};

export const MAX_SKIP_HISTORY = 200;
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

type SkipRow = {
  thread_id: string;
  author: string;
  author_key: string;
  at: string;
  url: string | null;
  summary: string | null;
  text: string | null;
};

function rowToSkip(row: SkipRow): Skip {
  const item: Skip = {
    threadId: row.thread_id,
    author: row.author,
    authorKey: row.author_key || normalizeAuthorKey(row.author),
    at: row.at,
  };
  if (row.url) item.url = row.url;
  if (row.summary) item.summary = row.summary;
  if (row.text) item.text = row.text;
  return item;
}

export function trimSkipHistory(
  skipped: Skip[],
  max: number = MAX_SKIP_HISTORY,
): Skip[] {
  return [...skipped]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, max);
}

export async function markSkipped(opts: {
  threadId: string;
  author: string;
  userId: string;
  url?: string;
  summary?: string;
  text?: string;
  nowMs?: number;
}): Promise<Skip> {
  const threadId = opts.threadId.trim();
  const author = opts.author.trim();
  const authorKey = normalizeAuthorKey(author);
  if (!threadId || !author || !authorKey) {
    throw new Error("threadId and author are required");
  }
  const userId = requireUserId(opts.userId);
  const tenantId = ensureUserTenant(userId);
  const nowMs = opts.nowMs ?? Date.now();
  const next: Skip = {
    threadId,
    author,
    authorKey,
    at: new Date(nowMs).toISOString(),
  };
  const url = optionalString(opts.url);
  const summary = optionalString(opts.summary);
  const text = optionalString(opts.text, MAX_TEXT_CHARS);
  if (url) next.url = url;
  if (summary) next.summary = summary;
  if (text) next.text = text;

  const db = getPlatformDb();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO desk_skips (
          user_id, tenant_id, thread_id, author, author_key, at, url, summary, text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, thread_id) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          author = excluded.author,
          author_key = excluded.author_key,
          at = excluded.at,
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
      next.url ?? null,
      next.summary ?? null,
      next.text ?? null,
    );
    db.prepare(
      `DELETE FROM desk_skips
        WHERE user_id = ? AND thread_id IN (
          SELECT thread_id FROM desk_skips
           WHERE user_id = ?
           ORDER BY at DESC, thread_id DESC
           LIMIT -1 OFFSET ?
        )`,
    ).run(userId, userId, MAX_SKIP_HISTORY);
  })();
  return next;
}

export async function listSkipHistory(opts: {
  userId: string;
  limit?: number;
}): Promise<Skip[]> {
  const userId = requireUserId(opts.userId);
  const rows = getPlatformDb()
    .prepare(
      `SELECT thread_id, author, author_key, at, url, summary, text
         FROM desk_skips
        WHERE user_id = ?
        ORDER BY at DESC, thread_id DESC
        LIMIT ?`,
    )
    .all(userId, Math.max(0, opts.limit ?? MAX_SKIP_HISTORY)) as SkipRow[];
  return rows.map(rowToSkip);
}

export async function getSkippedThreadIds(opts: {
  userId: string;
}): Promise<Set<string>> {
  const history = await listSkipHistory(opts);
  return new Set(history.map((d) => d.threadId).filter(Boolean));
}
