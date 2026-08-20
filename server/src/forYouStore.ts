/**
 * Durable For You suggestion inbox — SQL, per user.
 * Status: suggested | done | skipped. Unused cards expire on the next
 * daily run or after 48h. Not tweet-age.
 */
import { randomUUID } from "node:crypto";
import { getPlatformDb } from "./db.js";
import { startOfUtcDayIso } from "./ownPostStore.js";

export const FOR_YOU_KINDS = ["post", "quote", "repost", "reply"] as const;
export type ForYouKind = (typeof FOR_YOU_KINDS)[number];

export const FOR_YOU_STATUSES = ["suggested", "done", "skipped"] as const;
export type ForYouStatus = (typeof FOR_YOU_STATUSES)[number];

export const SUGGESTION_TTL_MS = 48 * 60 * 60 * 1000;

export type ForYouSuggestion = {
  id: string;
  userId: string;
  tenantId: string;
  kind: ForYouKind;
  status: ForYouStatus;
  why: string;
  draft: string | null;
  targetId: string | null;
  targetUrl: string | null;
  targetAuthor: string | null;
  createdAt: string;
  expiresAt: string;
  actedAt: string | null;
};

export type ForYouDraft = {
  kind: ForYouKind;
  why: string;
  draft?: string | null;
  targetId?: string | null;
  targetUrl?: string | null;
  targetAuthor?: string | null;
};

function isKind(value: string): value is ForYouKind {
  return (FOR_YOU_KINDS as readonly string[]).includes(value);
}

function isStatus(value: string): value is ForYouStatus {
  return (FOR_YOU_STATUSES as readonly string[]).includes(value);
}

function mapRow(row: Record<string, unknown>): ForYouSuggestion | null {
  const kind = typeof row.kind === "string" ? row.kind : "";
  const status = typeof row.status === "string" ? row.status : "";
  if (!isKind(kind) || !isStatus(status)) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    tenantId: String(row.tenant_id),
    kind,
    status,
    why: String(row.why ?? ""),
    draft: (row.draft as string | null) ?? null,
    targetId: (row.target_id as string | null) ?? null,
    targetUrl: (row.target_url as string | null) ?? null,
    targetAuthor: (row.target_author as string | null) ?? null,
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    actedAt: (row.acted_at as string | null) ?? null,
  };
}

export function hasForYouRunToday(
  userId: string,
  nowMs: number = Date.now(),
): boolean {
  const row = getPlatformDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM for_you_runs
       WHERE user_id = ? AND at >= ?`,
    )
    .get(userId, startOfUtcDayIso(new Date(nowMs))) as { n: number };
  return (Number(row.n) || 0) > 0;
}

export function recordForYouRun(
  userId: string,
  nowMs: number = Date.now(),
): void {
  getPlatformDb()
    .prepare(`INSERT INTO for_you_runs (id, user_id, at) VALUES (?, ?, ?)`)
    .run(randomUUID(), userId, new Date(nowMs).toISOString());
}

/** Close leftover suggested cards so the next daily set can replace them. */
export function expireOpenSuggestions(
  userId: string,
  nowMs: number = Date.now(),
): number {
  const info = getPlatformDb()
    .prepare(
      `UPDATE for_you_suggestions
       SET expires_at = ?
       WHERE user_id = ? AND status = 'suggested' AND expires_at > ?`,
    )
    .run(new Date(nowMs).toISOString(), userId, new Date(nowMs).toISOString());
  return info.changes;
}

export function insertSuggestions(opts: {
  userId: string;
  tenantId: string;
  drafts: ForYouDraft[];
  nowMs?: number;
}): ForYouSuggestion[] {
  const nowMs = opts.nowMs ?? Date.now();
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + SUGGESTION_TTL_MS).toISOString();
  const db = getPlatformDb();
  const insert = db.prepare(
    `INSERT INTO for_you_suggestions (
       id, user_id, tenant_id, kind, status, why, draft,
       target_id, target_url, target_author, created_at, expires_at, acted_at
     ) VALUES (?, ?, ?, ?, 'suggested', ?, ?, ?, ?, ?, ?, ?, NULL)`,
  );
  const out: ForYouSuggestion[] = [];
  const tx = db.transaction(() => {
    for (const draft of opts.drafts) {
      const id = randomUUID();
      insert.run(
        id,
        opts.userId,
        opts.tenantId,
        draft.kind,
        draft.why.trim(),
        draft.draft?.trim() || null,
        draft.targetId?.trim() || null,
        draft.targetUrl?.trim() || null,
        draft.targetAuthor?.trim() || null,
        createdAt,
        expiresAt,
      );
      out.push({
        id,
        userId: opts.userId,
        tenantId: opts.tenantId,
        kind: draft.kind,
        status: "suggested",
        why: draft.why.trim(),
        draft: draft.draft?.trim() || null,
        targetId: draft.targetId?.trim() || null,
        targetUrl: draft.targetUrl?.trim() || null,
        targetAuthor: draft.targetAuthor?.trim() || null,
        createdAt,
        expiresAt,
        actedAt: null,
      });
    }
  });
  tx();
  return out;
}

export function replaceDailySuggestions(opts: {
  userId: string;
  tenantId: string;
  drafts: ForYouDraft[];
  nowMs?: number;
}): ForYouSuggestion[] {
  const nowMs = opts.nowMs ?? Date.now();
  expireOpenSuggestions(opts.userId, nowMs);
  const rows = insertSuggestions(opts);
  recordForYouRun(opts.userId, nowMs);
  return rows;
}

export function getSuggestion(
  id: string,
  userId: string,
): ForYouSuggestion | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT * FROM for_you_suggestions WHERE id = ? AND user_id = ?`,
    )
    .get(id, userId) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function listActiveSuggestions(
  userId: string,
  nowMs: number = Date.now(),
): ForYouSuggestion[] {
  const rows = getPlatformDb()
    .prepare(
      `SELECT * FROM for_you_suggestions
       WHERE user_id = ? AND status = 'suggested' AND expires_at > ?
       ORDER BY created_at DESC`,
    )
    .all(userId, new Date(nowMs).toISOString()) as Array<Record<string, unknown>>;
  return rows.map(mapRow).filter((row): row is ForYouSuggestion => Boolean(row));
}

export function markSuggestion(opts: {
  id: string;
  userId: string;
  status: Exclude<ForYouStatus, "suggested">;
  nowMs?: number;
}): ForYouSuggestion | null {
  const now = new Date(opts.nowMs ?? Date.now()).toISOString();
  const db = getPlatformDb();
  const info = db
    .prepare(
      `UPDATE for_you_suggestions
       SET status = ?, acted_at = ?
       WHERE id = ? AND user_id = ? AND status = 'suggested'`,
    )
    .run(opts.status, now, opts.id, opts.userId);
  if (!info.changes) return null;
  const row = db
    .prepare(`SELECT * FROM for_you_suggestions WHERE id = ?`)
    .get(opts.id) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}
