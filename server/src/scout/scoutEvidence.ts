import { isRecord } from "../platform/unknownValue.js";
/**
 * Durable Scout evidence — SQL identity, per-user revision, read and write.
 *
 * One row per (user, event key). A confirmed reply is `reply:<replyId>` no
 * matter which adapter saw it (manual, Voice, webhook, discovery); explicit
 * Scout / For You skips and dismissals are `<action>:<surface>:<id>`. Rows
 * outlive the tank prune and the action-history caps. The revision advances
 * only when a row's facts change, never for reads, retries or duplicate
 * deliveries. Nothing here reads by tenant, calls X or a model, or knows
 * about the ScoutProfile reducer (C10 consumes this module).
 */
import { getPlatformDb } from "../db.js";
import { notifyScoutEvidenceChanged } from "./scoutProfileProjection.js";
import { THREAD_KINDS, type ThreadKind } from "./threadTriage.js";

export type ScoutEvidenceAction = "take" | "skip" | "dismiss";
export type ScoutEvidenceSurface = "scout" | "for-you";
export type ScoutEvidenceSource =
  | "manual"
  | "voice"
  | "webhook"
  | "discovery"
  | "scout"
  | "for-you"
  | "reconcile";
export type ScoutEvidenceNoteState = "unknown" | "stored" | "missing";

export const MAX_EVIDENCE_TOPICS = 12;

export type ScoutEvidenceContext = {
  /** Originating Scout card id (or For You suggestion id). */
  cardId?: string | null;
  conversationId?: string | null;
  parentId?: string | null;
  /** Known ThreadKind from the server-side card, or null when unknown. */
  threadKind?: ThreadKind | null;
  /** Normalized actual target author key, or null. */
  targetAuthor?: string | null;
  /** Bounded deterministic topic tokens. */
  topics?: readonly string[];
  /** Where the context came from: scout_cache | retained | watch | ... */
  contextSource?: string | null;
};

export type ScoutEvidenceInput = ScoutEvidenceContext & {
  userId: string;
  eventKey: string;
  action: ScoutEvidenceAction;
  source: ScoutEvidenceSource;
  /** Actual target (post replied to / card acted on). */
  targetId: string | null;
  /** Confirmed reply id; required for takes. */
  replyId?: string | null;
  /** Original action time (ISO). Never rewritten by later deliveries. */
  actedAt: string;
  /** Only `stored` / `missing` change an existing row. */
  noteState?: ScoutEvidenceNoteState;
  /** Material-change clock for revision bookkeeping (tests). */
  nowMs?: number;
};

export type ActionEvidenceInput = Omit<
  ScoutEvidenceInput,
  "userId" | "eventKey" | "action" | "actedAt" | "nowMs"
> & { eventKey: string };

export type ScoutEvidenceRow = {
  userId: string;
  eventKey: string;
  action: ScoutEvidenceAction;
  source: ScoutEvidenceSource;
  targetId: string | null;
  cardId: string | null;
  conversationId: string | null;
  parentId: string | null;
  replyId: string | null;
  actedAt: string;
  threadKind: ThreadKind | null;
  targetAuthor: string | null;
  topics: string[];
  contextSource: string | null;
  noteState: ScoutEvidenceNoteState;
  noteVerifiedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ScoutEvidenceRevision = {
  revision: number;
  updatedAt: string | null;
  lastEventKey: string | null;
};

type EvidenceSqlRow = {
  user_id: string;
  event_key: string;
  action: string;
  source: string;
  target_id: string | null;
  card_id: string | null;
  conversation_id: string | null;
  parent_id: string | null;
  reply_id: string | null;
  acted_at: string;
  thread_kind: string | null;
  target_author: string | null;
  topics_json: string | null;
  context_source: string | null;
  note_state: string;
  note_verified_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

const ACTIONS: ReadonlySet<string> = new Set(["take", "skip", "dismiss"]);
const SOURCES: ReadonlySet<string> = new Set([
  "manual",
  "voice",
  "webhook",
  "discovery",
  "scout",
  "for-you",
  "reconcile",
]);
const NOTE_STATES: ReadonlySet<string> = new Set([
  "unknown",
  "stored",
  "missing",
]);

/** Blank identities never own evidence; kept local to avoid a store cycle. */
export function requireEvidenceUserId(userId: unknown): string {
  const id = typeof userId === "string" ? userId.trim() : "";
  if (!id) throw new Error("userId is required");
  return id;
}

function optionalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t || null;
}

/** Only a closed ThreadKind survives; anything else is unknown (null). */
export function normalizeEvidenceKind(value: unknown): ThreadKind | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return THREAD_KINDS.find((kind) => kind === t) ?? null;
}

function normalizeTopics(topics: readonly string[] | undefined): string[] {
  if (!topics?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of topics) {
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_EVIDENCE_TOPICS) break;
  }
  return out;
}

function parseTopics(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? normalizeTopics(parsed.filter((t): t is string => typeof t === "string"))
      : [];
  } catch {
    return [];
  }
}

/** Confirmed replies share one identity across every adapter. */
export function takeEventKey(replyId: string): string {
  const id = optionalId(replyId);
  if (!id) throw new Error("replyId is required for a take");
  return `reply:${id}`;
}

/** Explicit skip / dismiss identity, scoped by the card or suggestion id. */
export function explicitEventKey(
  action: Exclude<ScoutEvidenceAction, "take">,
  surface: ScoutEvidenceSurface,
  id: string,
): string {
  const cleaned = optionalId(id);
  if (!cleaned) throw new Error("card id is required for explicit evidence");
  return `${action}:${surface}:${cleaned}`;
}

function rowFromSql(row: EvidenceSqlRow): ScoutEvidenceRow {
  return {
    userId: row.user_id,
    eventKey: row.event_key,
    action: (isEvidenceAction(row.action) ? row.action : "skip"),
    source: (isEvidenceSource(row.source)
      ? row.source
      : "reconcile"),
    targetId: row.target_id,
    cardId: row.card_id,
    conversationId: row.conversation_id,
    parentId: row.parent_id,
    replyId: row.reply_id,
    actedAt: row.acted_at,
    threadKind: normalizeEvidenceKind(row.thread_kind),
    targetAuthor: row.target_author,
    topics: parseTopics(row.topics_json),
    contextSource: row.context_source,
    noteState: (isEvidenceNoteState(row.note_state)
      ? row.note_state
      : "unknown"),
    noteVerifiedAt: row.note_verified_at,
    revision: Number(row.revision) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `user_id, event_key, action, source, target_id, card_id,
  conversation_id, parent_id, reply_id, acted_at, thread_kind, target_author,
  topics_json, context_source, note_state, note_verified_at, revision,
  created_at, updated_at`;

export function getScoutEvidence(
  userId: string,
  eventKey: string,
): ScoutEvidenceRow | null {
  const id = requireEvidenceUserId(userId);
  const row = parseEvidenceSqlRow(getPlatformDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM scout_evidence
        WHERE user_id = ? AND event_key = ?`,
    )
    .get(id, eventKey));
  return row ? rowFromSql(row) : null;
}

export function findScoutTakeByReplyId(
  userId: string,
  replyId: string,
): ScoutEvidenceRow | null {
  const id = requireEvidenceUserId(userId);
  const reply = optionalId(replyId);
  if (!reply) return null;
  const row = parseEvidenceSqlRow(getPlatformDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM scout_evidence
        WHERE user_id = ? AND action = 'take' AND reply_id = ?`,
    )
    .get(id, reply));
  return row ? rowFromSql(row) : null;
}

/** One user's evidence, oldest action first with a stable key tiebreak. */
export function listScoutEvidence(opts: {
  userId: string;
  limit?: number | null;
}): ScoutEvidenceRow[] {
  const id = requireEvidenceUserId(opts.userId);
  const limit = opts.limit ?? null;
  const rows = parseEvidenceSqlRow2(getPlatformDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM scout_evidence
        WHERE user_id = ?
        ORDER BY acted_at ASC, event_key ASC
        ${limit === null ? "" : "LIMIT ?"}`,
    )
    .all(...(limit === null ? [id] : [id, Math.max(0, limit)])));
  return rows.map(rowFromSql);
}

export function listScoutEvidenceNeedingNoteCheck(opts: {
  userId: string;
  before?: { actedAt: string; eventKey: string };
  limit: number;
}): ScoutEvidenceRow[] {
  const id = requireEvidenceUserId(opts.userId);
  const clauses = [
    "user_id = ?",
    "action = 'take'",
    "reply_id IS NOT NULL",
    "note_state IN ('unknown', 'missing')",
  ];
  const params: unknown[] = [id];
  if (opts.before) {
    clauses.push("(acted_at < ? OR (acted_at = ? AND event_key < ?))");
    params.push(opts.before.actedAt, opts.before.actedAt, opts.before.eventKey);
  }
  const rows = parseEvidenceSqlRow3(getPlatformDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM scout_evidence
       WHERE ${clauses.join(" AND ")}
       ORDER BY acted_at DESC, event_key DESC
       LIMIT ?`,
    )
    .all(...params, Math.max(1, opts.limit)));
  return rows.map(rowFromSql);
}

export function readScoutEvidenceRevision(userId: string): ScoutEvidenceRevision {
  const id = requireEvidenceUserId(userId);
  const row = parseReadScoutEvidenceRevisionRow(getPlatformDb()
    .prepare(
      `SELECT revision, updated_at, last_event_key
         FROM scout_evidence_revisions WHERE user_id = ?`,
    )
    .get(id));
  return {
    revision: Number(row?.revision ?? 0) || 0,
    updatedAt: row?.updated_at ?? null,
    lastEventKey: row?.last_event_key ?? null,
  };
}

function bumpRevision(userId: string, eventKey: string, nowIso: string): number {
  const db = getPlatformDb();
  db.prepare(
    `INSERT INTO scout_evidence_revisions (user_id, revision, updated_at, last_event_key)
     VALUES (?, 1, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       revision = scout_evidence_revisions.revision + 1,
       updated_at = excluded.updated_at,
       last_event_key = excluded.last_event_key`,
  ).run(userId, nowIso, eventKey);
  return readScoutEvidenceRevision(userId).revision;
}

function validateInput(input: ScoutEvidenceInput): {
  userId: string;
  eventKey: string;
  action: ScoutEvidenceAction;
  source: ScoutEvidenceSource;
  replyId: string | null;
  actedAt: string;
} {
  const userId = requireEvidenceUserId(input.userId);
  const eventKey = optionalId(input.eventKey);
  if (!eventKey) throw new Error("eventKey is required");
  if (!isEvidenceAction(input.action)) throw new Error("invalid evidence action");
  if (!isEvidenceSource(input.source)) throw new Error("invalid evidence source");
  const replyId = optionalId(input.replyId);
  if (input.action === "take" && !replyId) {
    throw new Error("a take requires a confirmed replyId");
  }
  if (input.action === "take" && eventKey !== takeEventKey(replyId!)) {
    throw new Error("take eventKey must be reply:<replyId>");
  }
  const actedMs = Date.parse(input.actedAt);
  if (!Number.isFinite(actedMs)) throw new Error("actedAt must be ISO time");
  return {
    userId,
    eventKey,
    action: input.action,
    source: input.source,
    replyId,
    actedAt: new Date(actedMs).toISOString(),
  };
}

/**
 * Insert or enrich one observation. Runs as a (nested) transaction so a
 * caller's explicit-action transaction rolls back together with it.
 *
 * Existing rows keep their original action time, source and any known kind;
 * enrichment only fills missing facts. `changed` is true only when a fact
 * actually changed, which is the only time the user's revision advances.
 */
export function recordScoutEvidence(input: ScoutEvidenceInput): {
  changed: boolean;
  row: ScoutEvidenceRow;
} {
  const v = validateInput(input);
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString();
  const incoming = {
    targetId: optionalId(input.targetId),
    cardId: optionalId(input.cardId),
    conversationId: optionalId(input.conversationId),
    parentId: optionalId(input.parentId),
    threadKind: normalizeEvidenceKind(input.threadKind),
    targetAuthor: optionalId(input.targetAuthor),
    topics: normalizeTopics(input.topics),
    contextSource: optionalId(input.contextSource),
    noteState:
      input.noteState && isEvidenceNoteState(input.noteState)
        ? input.noteState
        : "unknown",
  };
  const db = getPlatformDb();
  const result = db.transaction((): { changed: boolean; row: ScoutEvidenceRow } => {
    const existing = getScoutEvidence(v.userId, v.eventKey);
    if (!existing) {
      const revision = bumpRevision(v.userId, v.eventKey, nowIso);
      db.prepare(
        `INSERT INTO scout_evidence (
           user_id, event_key, action, source, target_id, card_id,
           conversation_id, parent_id, reply_id, acted_at, thread_kind,
           target_author, topics_json, context_source, note_state,
           note_verified_at, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        v.userId,
        v.eventKey,
        v.action,
        v.source,
        incoming.targetId,
        incoming.cardId,
        incoming.conversationId,
        incoming.parentId,
        v.replyId,
        v.actedAt,
        incoming.threadKind,
        incoming.targetAuthor,
        incoming.topics.length ? JSON.stringify(incoming.topics) : null,
        incoming.contextSource,
        incoming.noteState,
        incoming.noteState === "unknown" ? null : nowIso,
        revision,
        nowIso,
        nowIso,
      );
      return { changed: true, row: getScoutEvidence(v.userId, v.eventKey)! };
    }
    if (existing.action !== v.action) {
      // Same identity cannot flip action; keep the original observation.
      return { changed: false, row: existing };
    }
    const next: ScoutEvidenceRow = { ...existing };
    let changed = false;
    const fill = <K extends "targetId" | "cardId" | "conversationId" | "parentId" | "targetAuthor">(
      key: K,
    ) => {
      if (next[key] === null && incoming[key] !== null) {
        next[key] = incoming[key];
        changed = true;
      }
    };
    fill("targetId");
    fill("cardId");
    fill("conversationId");
    fill("parentId");
    fill("targetAuthor");
    if (next.replyId === null && v.replyId !== null) {
      next.replyId = v.replyId;
      changed = true;
    }
    // A known kind is never replaced by unknown or by a conflicting value.
    if (next.threadKind === null && incoming.threadKind !== null) {
      next.threadKind = incoming.threadKind;
      changed = true;
    }
    if (next.topics.length === 0 && incoming.topics.length > 0) {
      next.topics = incoming.topics;
      changed = true;
    }
    if (next.contextSource === null && incoming.contextSource) {
      next.contextSource = incoming.contextSource;
      changed = true;
    }
    if (
      incoming.noteState !== "unknown" &&
      incoming.noteState !== next.noteState
    ) {
      next.noteState = incoming.noteState;
      next.noteVerifiedAt = nowIso;
      changed = true;
    }
    if (!changed) return { changed: false, row: existing };
    const revision = bumpRevision(v.userId, v.eventKey, nowIso);
    db.prepare(
      `UPDATE scout_evidence SET
         target_id = ?, card_id = ?, conversation_id = ?, parent_id = ?,
         reply_id = ?, thread_kind = ?, target_author = ?, topics_json = ?,
         context_source = ?, note_state = ?, note_verified_at = ?,
         revision = ?, updated_at = ?
       WHERE user_id = ? AND event_key = ?`,
    ).run(
      next.targetId,
      next.cardId,
      next.conversationId,
      next.parentId,
      next.replyId,
      next.threadKind,
      next.targetAuthor,
      next.topics.length ? JSON.stringify(next.topics) : null,
      next.contextSource,
      next.noteState,
      next.noteVerifiedAt,
      revision,
      nowIso,
      v.userId,
      v.eventKey,
    );
    return { changed: true, row: getScoutEvidence(v.userId, v.eventKey)! };
  })();
  if (result.changed) {
    notifyScoutEvidenceChanged({
      userId: v.userId,
      revision: result.row.revision,
    });
  }
  return result;
}

/**
 * Stored-note verification for a confirmed take, kept separate from the
 * confirmation itself. No-op (false) when the take is unknown or unchanged.
 */
export function setScoutEvidenceNoteState(opts: {
  userId: string;
  replyId: string;
  state: Exclude<ScoutEvidenceNoteState, "unknown">;
  nowMs?: number;
}): boolean {
  const userId = requireEvidenceUserId(opts.userId);
  const replyId = optionalId(opts.replyId);
  if (!replyId) return false;
  if (opts.state !== "stored" && opts.state !== "missing") return false;
  const db = getPlatformDb();
  const result = db.transaction((): { changed: boolean; revision: number | null } => {
    const existing = findScoutTakeByReplyId(userId, replyId);
    if (!existing || existing.noteState === opts.state) {
      return { changed: false, revision: null };
    }
    const nowIso = new Date(opts.nowMs ?? Date.now()).toISOString();
    const revision = bumpRevision(userId, existing.eventKey, nowIso);
    db.prepare(
      `UPDATE scout_evidence
          SET note_state = ?, note_verified_at = ?, revision = ?, updated_at = ?
        WHERE user_id = ? AND event_key = ?`,
    ).run(opts.state, nowIso, revision, nowIso, userId, existing.eventKey);
    return { changed: true, revision };
  })();
  if (result.changed) {
    notifyScoutEvidenceChanged({
      userId,
      revision: result.revision!,
    });
  }
  return result.changed;
}

/** Resumable keyset cursor for bounded reconciliation scopes. */
export function readScoutEvidenceCursor<T>(
  userId: string,
  scope: string,
  isCursor: (value: unknown) => value is T,
): T | null;
export function readScoutEvidenceCursor(userId: string, scope: string): unknown;
export function readScoutEvidenceCursor(
  userId: string,
  scope: string,
  isCursor?: (value: unknown) => boolean,
): unknown {
  const id = requireEvidenceUserId(userId);
  const row = parseReadScoutEvidenceCursorRow(getPlatformDb()
    .prepare(
      `SELECT cursor_json FROM scout_evidence_cursors
        WHERE user_id = ? AND scope = ?`,
    )
    .get(id, scope));
  if (!row?.cursor_json) return null;
  try {
    const cursor: unknown = JSON.parse(row.cursor_json);
    return !isCursor || isCursor(cursor) ? cursor : null;
  } catch {
    return null;
  }
}

export function writeScoutEvidenceCursor(
  userId: string,
  scope: string,
  cursor: unknown | null,
  nowMs: number = Date.now(),
): void {
  const id = requireEvidenceUserId(userId);
  getPlatformDb()
    .prepare(
      `INSERT INTO scout_evidence_cursors (user_id, scope, cursor_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, scope) DO UPDATE SET
         cursor_json = excluded.cursor_json,
         updated_at = excluded.updated_at`,
    )
    .run(
      id,
      scope,
      cursor === null || cursor === undefined ? null : JSON.stringify(cursor),
      new Date(nowMs).toISOString(),
    );
}

function parseEvidenceSqlRow(value: unknown): EvidenceSqlRow | undefined {
  const valid = (row: unknown): row is EvidenceSqlRow | undefined =>
    (row === undefined || (isRecord(row) &&
    typeof row.user_id === "string" &&
    typeof row.event_key === "string" &&
    typeof row.action === "string" &&
    typeof row.source === "string" &&
    (row.target_id === null || typeof row.target_id === "string") &&
    (row.card_id === null || typeof row.card_id === "string") &&
    (row.conversation_id === null || typeof row.conversation_id === "string") &&
    (row.parent_id === null || typeof row.parent_id === "string") &&
    (row.reply_id === null || typeof row.reply_id === "string") &&
    typeof row.acted_at === "string" &&
    (row.thread_kind === null || typeof row.thread_kind === "string") &&
    (row.target_author === null || typeof row.target_author === "string") &&
    (row.topics_json === null || typeof row.topics_json === "string") &&
    (row.context_source === null || typeof row.context_source === "string") &&
    typeof row.note_state === "string" &&
    (row.note_verified_at === null || typeof row.note_verified_at === "string") &&
    typeof row.revision === "number" &&
    typeof row.created_at === "string" &&
    typeof row.updated_at === "string"));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseEvidenceSqlRow2(value: unknown): EvidenceSqlRow[] {
  const valid = (row: unknown): row is EvidenceSqlRow[] =>
    (Array.isArray(row) && row.every((item: unknown) => (isRecord(item) &&
    typeof item.user_id === "string" &&
    typeof item.event_key === "string" &&
    typeof item.action === "string" &&
    typeof item.source === "string" &&
    (item.target_id === null || typeof item.target_id === "string") &&
    (item.card_id === null || typeof item.card_id === "string") &&
    (item.conversation_id === null || typeof item.conversation_id === "string") &&
    (item.parent_id === null || typeof item.parent_id === "string") &&
    (item.reply_id === null || typeof item.reply_id === "string") &&
    typeof item.acted_at === "string" &&
    (item.thread_kind === null || typeof item.thread_kind === "string") &&
    (item.target_author === null || typeof item.target_author === "string") &&
    (item.topics_json === null || typeof item.topics_json === "string") &&
    (item.context_source === null || typeof item.context_source === "string") &&
    typeof item.note_state === "string" &&
    (item.note_verified_at === null || typeof item.note_verified_at === "string") &&
    typeof item.revision === "number" &&
    typeof item.created_at === "string" &&
    typeof item.updated_at === "string")));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseEvidenceSqlRow3(value: unknown): EvidenceSqlRow[] {
  const valid = (row: unknown): row is EvidenceSqlRow[] =>
    (Array.isArray(row) && row.every((item: unknown) => (isRecord(item) &&
    typeof item.user_id === "string" &&
    typeof item.event_key === "string" &&
    typeof item.action === "string" &&
    typeof item.source === "string" &&
    (item.target_id === null || typeof item.target_id === "string") &&
    (item.card_id === null || typeof item.card_id === "string") &&
    (item.conversation_id === null || typeof item.conversation_id === "string") &&
    (item.parent_id === null || typeof item.parent_id === "string") &&
    (item.reply_id === null || typeof item.reply_id === "string") &&
    typeof item.acted_at === "string" &&
    (item.thread_kind === null || typeof item.thread_kind === "string") &&
    (item.target_author === null || typeof item.target_author === "string") &&
    (item.topics_json === null || typeof item.topics_json === "string") &&
    (item.context_source === null || typeof item.context_source === "string") &&
    typeof item.note_state === "string" &&
    (item.note_verified_at === null || typeof item.note_verified_at === "string") &&
    typeof item.revision === "number" &&
    typeof item.created_at === "string" &&
    typeof item.updated_at === "string")));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseReadScoutEvidenceRevisionRow(value: unknown): | { revision: number; updated_at: string | null; last_event_key: string | null }
    | undefined {
  const valid = (row: unknown): row is | { revision: number; updated_at: string | null; last_event_key: string | null }
    | undefined =>
    (row === undefined || (isRecord(row) &&
    typeof row.revision === "number" &&
    (row.updated_at === null || typeof row.updated_at === "string") &&
    (row.last_event_key === null || typeof row.last_event_key === "string")));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseReadScoutEvidenceCursorRow(value: unknown): { cursor_json: string | null } | undefined {
  const valid = (row: unknown): row is { cursor_json: string | null } | undefined =>
    (row === undefined || (isRecord(row) &&
    (row.cursor_json === null || typeof row.cursor_json === "string")));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function isEvidenceAction(value: string): value is ScoutEvidenceAction {
  return ACTIONS.has(value);
}

function isEvidenceSource(value: string): value is ScoutEvidenceSource {
  return SOURCES.has(value);
}

function isEvidenceNoteState(value: string): value is ScoutEvidenceNoteState {
  return NOTE_STATES.has(value);
}
