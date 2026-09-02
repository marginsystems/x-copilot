/**
 * Durable For You suggestion inbox — SQL, per user.
 * Status: suggested | done | skipped. Unused cards expire on the next
 * daily run or after 48h. Not tweet-age.
 */
import { randomUUID } from "node:crypto";
import {
  SKIPPED_THEME_WINDOW_MS,
  matchesSkippedTheme,
  withoutSkippedThemes,
} from "./forYouTheme.js";
import { getPlatformDb } from "./db.js";
import { isOwnPostRemixCopy } from "./forYouRemix.js";
import { startOfUtcDayIso } from "./ownPostStore.js";

export const FOR_YOU_KINDS = ["post", "quote", "repost", "reply"] as const;
export type ForYouKind = (typeof FOR_YOU_KINDS)[number];

export const FOR_YOU_STATUSES = ["suggested", "done", "skipped"] as const;
export type ForYouStatus = (typeof FOR_YOU_STATUSES)[number];

export const SUGGESTION_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Approach `why` is copilot-to-operator. Rewrite first-person slips so
 * the desk never says "My posts got…". Draft text is untouched.
 */
export function secondPersonWhy(why: string): string {
  return why
    .replace(/\bmy\b/gi, (m) => (m[0] === "M" ? "Your" : "your"))
    .replace(/\bI['’]m\b/gi, (m) => (m[0] === "I" ? "You're" : "you're"))
    .replace(/\bI['’]ve\b/gi, (m) => (m[0] === "I" ? "You've" : "you've"))
    .replace(/\bI['’]d\b/gi, (m) => (m[0] === "I" ? "You'd" : "you'd"))
    .replace(/\bI['’]ll\b/gi, (m) => (m[0] === "I" ? "You'll" : "you'll"))
    .replace(/\bI\s+am\b/gi, (m) => (m[0] === "I" ? "You're" : "you're"))
    .replace(/\bI\s+was\b/gi, (m) => (m[0] === "I" ? "You were" : "you were"))
    .replace(/\bI\s+wasn['’]t\b/gi, (m) => (m[0] === "I" ? "You weren't" : "you weren't"))
    .replace(/\bI\b/gi, (m) => (m[0] === "I" ? "You" : "you"))
    .replace(/\bme\b/gi, (m) => (m[0] === "M" ? "You" : "you"))
    .replace(/\bmine\b/gi, (m) => (m[0] === "M" ? "Yours" : "yours"));
}

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
  origin: "daily" | "extra";
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
    why: secondPersonWhy(String(row.why ?? "")),
    draft: (row.draft as string | null) ?? null,
    targetId: (row.target_id as string | null) ?? null,
    targetUrl: (row.target_url as string | null) ?? null,
    targetAuthor: (row.target_author as string | null) ?? null,
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    actedAt: (row.acted_at as string | null) ?? null,
    origin: row.origin === "extra" ? "extra" : "daily",
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

/** Close leftover suggested cards so the next daily set can replace them.
 *  Paid extra batches (origin='extra') keep their 48h TTL instead. */
export function expireOpenSuggestions(
  userId: string,
  nowMs: number = Date.now(),
): number {
  const info = getPlatformDb()
    .prepare(
      `UPDATE for_you_suggestions
       SET expires_at = ?
       WHERE user_id = ? AND status = 'suggested' AND origin != 'extra' AND expires_at > ?`,
    )
    .run(new Date(nowMs).toISOString(), userId, new Date(nowMs).toISOString());
  return info.changes;
}

export function listRecentSkippedSuggestions(
  userId: string,
  nowMs: number = Date.now(),
): ForYouSuggestion[] {
  const since = new Date(nowMs - SKIPPED_THEME_WINDOW_MS).toISOString();
  const rows = getPlatformDb()
    .prepare(
      `SELECT * FROM for_you_suggestions
       WHERE user_id = ? AND status = 'skipped' AND acted_at >= ?
       ORDER BY acted_at DESC`,
    )
    .all(userId, since) as Array<Record<string, unknown>>;
  return rows.map(mapRow).filter((row): row is ForYouSuggestion => Boolean(row));
}

export function insertSuggestions(opts: {
  userId: string;
  tenantId: string;
  drafts: ForYouDraft[];
  nowMs?: number;
  origin?: "daily" | "extra";
}): ForYouSuggestion[] {
  const nowMs = opts.nowMs ?? Date.now();
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + SUGGESTION_TTL_MS).toISOString();
  const origin = opts.origin ?? "daily";
  const drafts = withoutSkippedThemes(
    opts.drafts,
    listRecentSkippedSuggestions(opts.userId, nowMs),
  ).filter(
    (draft) => draft.kind !== "post" || !isOwnPostRemixCopy(draft.why, draft.draft),
  );
  const db = getPlatformDb();
  const insert = db.prepare(
    `INSERT INTO for_you_suggestions (
       id, user_id, tenant_id, kind, status, why, draft,
       target_id, target_url, target_author, created_at, expires_at, acted_at, origin
     ) VALUES (?, ?, ?, ?, 'suggested', ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  );
  const out: ForYouSuggestion[] = [];
  const tx = db.transaction(() => {
    for (const draft of drafts) {
      const id = randomUUID();
      const why = secondPersonWhy(draft.why.trim());
      insert.run(
        id,
        opts.userId,
        opts.tenantId,
        draft.kind,
        why,
        draft.draft?.trim() || null,
        draft.targetId?.trim() || null,
        draft.targetUrl?.trim() || null,
        draft.targetAuthor?.trim() || null,
        createdAt,
        expiresAt,
        origin,
      );
      out.push({
        id,
        userId: opts.userId,
        tenantId: opts.tenantId,
        kind: draft.kind,
        status: "suggested",
        why,
        draft: draft.draft?.trim() || null,
        targetId: draft.targetId?.trim() || null,
        targetUrl: draft.targetUrl?.trim() || null,
        targetAuthor: draft.targetAuthor?.trim() || null,
        createdAt,
        expiresAt,
        actedAt: null,
        origin,
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
  const active = rows
    .map(mapRow)
    .filter((row): row is ForYouSuggestion => Boolean(row))
    .filter(
      (row) => row.kind !== "post" || !isOwnPostRemixCopy(row.why, row.draft),
    );
  return withoutSkippedThemes(
    active,
    listRecentSkippedSuggestions(userId, nowMs),
  );
}

/** Confirmed For You cards of one kind since `sinceIso` (UTC-day missions). */
export function countDoneSuggestionsSince(opts: {
  userId: string;
  kind: ForYouKind;
  sinceIso: string;
}): number {
  const row = getPlatformDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM for_you_suggestions
        WHERE user_id = ? AND kind = ? AND status = 'done' AND acted_at >= ?`,
    )
    .get(opts.userId, opts.kind, opts.sinceIso) as { n: number };
  return Number(row.n) || 0;
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
  const mapped = row ? mapRow(row) : null;
  if (mapped && opts.status === "skipped") {
    suppressMatchingSuggestions({
      userId: opts.userId,
      seed: mapped,
      nowMs: opts.nowMs ?? Date.now(),
    });
  }
  return mapped;
}

/** Skip one card, bury live remixes of the same thesis or target. */
export function suppressMatchingSuggestions(opts: {
  userId: string;
  seed: ForYouSuggestion;
  nowMs?: number;
}): number {
  const nowMs = opts.nowMs ?? Date.now();
  const now = new Date(nowMs).toISOString();
  const live = getPlatformDb()
    .prepare(
      `SELECT * FROM for_you_suggestions
       WHERE user_id = ? AND status = 'suggested' AND expires_at > ? AND id != ?`,
    )
    .all(opts.userId, now, opts.seed.id) as Array<Record<string, unknown>>;
  let changed = 0;
  const update = getPlatformDb().prepare(
    `UPDATE for_you_suggestions
     SET status = 'skipped', acted_at = ?
     WHERE id = ? AND user_id = ? AND status = 'suggested'`,
  );
  for (const raw of live) {
    const row = mapRow(raw);
    if (!row || !matchesSkippedTheme(row, [opts.seed])) continue;
    changed += update.run(now, row.id, opts.userId).changes;
  }
  return changed;
}
