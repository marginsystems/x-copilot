import { isRecord } from "../platform/unknownValue.js";
/**
 * Server-owned target context for Scout evidence.
 *
 * Kind, author and topics are read from the user's own tank card (never a
 * request body) before an action prunes it, and retained in
 * `scout_target_context` at watch / approach-lock time so a webhook that
 * arrives after the lock is cleared can still attach them. Missing or
 * ambiguous context stays unknown (null) — it is never guessed as `other`.
 * The tokenizer is deterministic: no model, no generated summaries.
 */
import { getPlatformDb } from "../db.js";
import { normalizeAuthorKey } from "../desk/interactionCooldown.js";
import { getWatchedThread } from "../desk/ownPostStore.js";
import { getLastScout, type LastScoutSnapshot } from "./scoutCache.js";
import {
  MAX_EVIDENCE_TOPICS,
  normalizeEvidenceKind,
  requireEvidenceUserId,
  type ScoutEvidenceContext,
} from "./scoutEvidence.js";
import type { ThreadCard } from "./threadCard.js";
import type { ThreadKind } from "./threadTriage.js";

export const MAX_TOPIC_INPUT_CHARS = 2000;
export const MIN_TOPIC_CHARS = 3;
export const MAX_TOPIC_CHARS = 32;

/** Fixed English stop list; keep sorted so the tokenizer stays reviewable. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "about", "above", "after", "again", "against", "all", "also", "and",
  "any", "are", "because", "been", "before", "being", "below", "between",
  "both", "but", "can", "cannot", "could", "did", "does", "doing", "don",
  "down", "during", "each", "few", "for", "from", "further", "had", "has",
  "have", "having", "her", "here", "hers", "herself", "him", "himself",
  "his", "how", "into", "its", "itself", "just", "like", "more", "most",
  "not", "now", "off", "once", "only", "other", "our", "ours", "ourselves",
  "out", "over", "own", "same", "she", "should", "some", "such", "than",
  "that", "the", "their", "theirs", "them", "themselves", "then", "there",
  "these", "they", "this", "those", "through", "too", "under", "until",
  "very", "was", "were", "what", "when", "where", "which", "while", "who",
  "whom", "why", "will", "with", "would", "you", "your", "yours",
  "yourself", "yourselves", "amp", "via", "http", "https", "www",
]);

const URL_RE =
  /(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s]*/giu;
const HANDLE_RE = /(^|[^\p{L}\p{N}_])@[\p{L}\p{N}_]+/gu;
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;

/**
 * Lowercase Unicode words minus URLs, handles and stop words; deduped in
 * first-seen order; input capped at 2,000 chars; at most 12 tokens of 3–32
 * chars each. Pure numbers (X ids, counts) never become topics.
 */
export function tokenizeScoutTopics(
  text: string | null | undefined,
): string[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const source = text
    .slice(0, MAX_TOPIC_INPUT_CHARS)
    .toLowerCase()
    .replace(URL_RE, " ")
    .replace(HANDLE_RE, "$1 ");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of source.match(WORD_RE) ?? []) {
    const token = match.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (token.length < MIN_TOPIC_CHARS || token.length > MAX_TOPIC_CHARS) {
      continue;
    }
    if (!/\p{L}/u.test(token)) continue;
    if (STOP_WORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= MAX_EVIDENCE_TOPICS) break;
  }
  return out;
}

/**
 * Normalized actual-target author key, or null for placeholders and numeric
 * X ids (`@unknown`, `@1234567890`) that the webhook falls back to.
 */
export function normalizeEvidenceAuthor(
  author: string | null | undefined,
): string | null {
  if (typeof author !== "string") return null;
  const key = normalizeAuthorKey(author);
  if (!key || key === "unknown" || key === "i") return null;
  if (/^\d+$/.test(key)) return null;
  if (!/^[a-z0-9_]{1,15}$/.test(key)) return null;
  return key;
}

export type RetainedTargetContext = {
  targetId: string;
  cardId: string | null;
  conversationId: string | null;
  inReplyToId: string | null;
  author: string | null;
  threadKind: ThreadKind | null;
  topics: string[];
  contextSource: string;
  retainedAt: string;
};

type RetainedRow = {
  target_id: string;
  card_id: string | null;
  conversation_id: string | null;
  in_reply_to_id: string | null;
  author: string | null;
  thread_kind: string | null;
  topics_json: string | null;
  context_source: string;
  retained_at: string;
};

function optionalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t || null;
}

function parseTopics(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .filter((t): t is string => typeof t === "string" && t.trim() !== "")
          .slice(0, MAX_EVIDENCE_TOPICS)
      : [];
  } catch {
    return [];
  }
}

function retainedFromRow(row: RetainedRow): RetainedTargetContext {
  return {
    targetId: row.target_id,
    cardId: row.card_id,
    conversationId: row.conversation_id,
    inReplyToId: row.in_reply_to_id,
    author: row.author,
    threadKind: normalizeEvidenceKind(row.thread_kind),
    topics: parseTopics(row.topics_json),
    contextSource: row.context_source,
    retainedAt: row.retained_at,
  };
}

const RETAINED_COLUMNS = `target_id, card_id, conversation_id, in_reply_to_id,
  author, thread_kind, topics_json, context_source, retained_at`;

export function readRetainedTargetContext(
  userId: string,
  targetId: string,
): RetainedTargetContext | null {
  const id = requireEvidenceUserId(userId);
  const target = optionalId(targetId);
  if (!target) return null;
  const row = parseRetainedRow(getPlatformDb()
    .prepare(
      `SELECT ${RETAINED_COLUMNS} FROM scout_target_context
        WHERE user_id = ? AND target_id = ?`,
    )
    .get(id, target));
  return row ? retainedFromRow(row) : null;
}

/** Conversation fallback: only an unambiguous single retained card counts. */
export function readRetainedContextByConversation(
  userId: string,
  conversationId: string,
): RetainedTargetContext | null {
  const id = requireEvidenceUserId(userId);
  const conversation = optionalId(conversationId);
  if (!conversation) return null;
  const rows = parseRetainedRow2(getPlatformDb()
    .prepare(
      `WITH matching AS (
         SELECT ${RETAINED_COLUMNS} FROM scout_target_context
          WHERE user_id = ? AND card_id IS NOT NULL AND conversation_id = ?
         UNION
         SELECT ${RETAINED_COLUMNS} FROM scout_target_context
          WHERE user_id = ? AND card_id IS NOT NULL AND target_id = ?
       )
       SELECT ${RETAINED_COLUMNS} FROM matching
        WHERE (SELECT COUNT(DISTINCT card_id) FROM matching) = 1
        ORDER BY retained_at DESC LIMIT 1`,
    )
    .all(id, conversation, id, conversation));
  if (rows.length === 0) return null;
  return retainedFromRow(rows[0]!);
}

/**
 * Upsert retained context. Enrichment fills gaps only: a known kind is never
 * replaced by null or by a different value, author/topics fill when missing.
 */
export function retainScoutTargetContext(input: {
  userId: string;
  targetId: string;
  cardId?: string | null;
  conversationId?: string | null;
  inReplyToId?: string | null;
  author?: string | null;
  threadKind?: ThreadKind | null;
  topics?: readonly string[];
  contextSource: string;
  nowMs?: number;
}): RetainedTargetContext | null {
  const userId = requireEvidenceUserId(input.userId);
  const targetId = optionalId(input.targetId);
  if (!targetId) return null;
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString();
  const db = getPlatformDb();
  return db.transaction((): RetainedTargetContext => {
    const prior = readRetainedTargetContext(userId, targetId);
    const kind = prior?.threadKind ?? normalizeEvidenceKind(input.threadKind);
    const author = prior?.author ?? normalizeEvidenceAuthor(input.author);
    const topics = prior?.topics.length
      ? prior.topics
      : [...(input.topics ?? [])].slice(0, MAX_EVIDENCE_TOPICS);
    const contextSource =
      prior && prior.threadKind !== null ? prior.contextSource : input.contextSource;
    db.prepare(
      `INSERT INTO scout_target_context (
         user_id, target_id, card_id, conversation_id, in_reply_to_id, author,
         thread_kind, topics_json, context_source, retained_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, target_id) DO UPDATE SET
         card_id = COALESCE(scout_target_context.card_id, excluded.card_id),
         conversation_id = COALESCE(scout_target_context.conversation_id, excluded.conversation_id),
         in_reply_to_id = COALESCE(scout_target_context.in_reply_to_id, excluded.in_reply_to_id),
         author = excluded.author,
         thread_kind = excluded.thread_kind,
         topics_json = excluded.topics_json,
         context_source = excluded.context_source,
         retained_at = excluded.retained_at`,
    ).run(
      userId,
      targetId,
      optionalId(input.cardId),
      optionalId(input.conversationId),
      optionalId(input.inReplyToId),
      author,
      kind,
      topics.length ? JSON.stringify(topics) : null,
      contextSource,
      nowIso,
    );
    // Retained context is durable: a delayed reply to an old watched or
    // locked target must still find its kind, so nothing here evicts rows.
    return readRetainedTargetContext(userId, targetId)!;
  })();
}

export type ScoutCardContext = ScoutEvidenceContext & {
  targetId: string | null;
  cardId: string | null;
  conversationId: string | null;
  parentId: string | null;
  threadKind: ThreadKind | null;
  targetAuthor: string | null;
  topics: string[];
  contextSource: string;
};

function cardIds(card: ThreadCard): string[] {
  return [card.id, card.conversationId, card.inReplyToId]
    .map((id) => id?.trim() ?? "")
    .filter(Boolean);
}

function contextFromCard(
  card: ThreadCard,
  targetId: string | null,
): ScoutCardContext {
  return {
    targetId: targetId ?? card.id,
    cardId: card.id,
    conversationId: optionalId(card.conversationId),
    parentId: optionalId(card.inReplyToId),
    threadKind: normalizeEvidenceKind(card.threadKind),
    targetAuthor: normalizeEvidenceAuthor(card.author),
    topics: tokenizeScoutTopics(
      [card.text, card.summary].filter(Boolean).join(" "),
    ),
    contextSource: "scout_cache",
  };
}

/**
 * Locate the user's own tank card. Exact id first; conversation / parent
 * fallback only when exactly one card matches.
 */
export function cardContextFromSnapshot(
  snapshot: LastScoutSnapshot | null | undefined,
  ids: {
    targetId?: string | null;
    conversationId?: string | null;
    inReplyToId?: string | null;
  },
): ScoutCardContext | null {
  const threads = snapshot?.threads ?? [];
  if (!threads.length) return null;
  const targetId = optionalId(ids.targetId);
  if (targetId) {
    const exact = threads.find((t) => t.id.trim() === targetId);
    if (exact) return contextFromCard(exact, targetId);
  }
  const related = [targetId, optionalId(ids.conversationId), optionalId(ids.inReplyToId)]
    .filter((id): id is string => Boolean(id));
  if (!related.length) return null;
  const matches = threads.filter((t) =>
    cardIds(t).some((id) => related.includes(id)),
  );
  if (matches.length !== 1) return null;
  return contextFromCard(matches[0]!, targetId);
}

function contextFromRetained(
  retained: RetainedTargetContext,
  targetId: string | null,
): ScoutCardContext {
  return {
    targetId: targetId ?? retained.targetId,
    cardId: retained.cardId ?? retained.targetId,
    conversationId: retained.conversationId,
    parentId: retained.inReplyToId,
    threadKind: retained.threadKind,
    targetAuthor: retained.author,
    topics: retained.topics,
    contextSource: retained.contextSource === "scout_cache"
      ? "retained"
      : retained.contextSource,
  };
}

/**
 * Resolve context for an action on `targetId` before any synchronous SQL
 * transaction: tank card, then retained context, then the watch list (author
 * only). Returns null when nothing server-owned is known.
 */
export async function captureScoutTargetContext(opts: {
  userId: string;
  targetId: string | null | undefined;
  conversationId?: string | null;
  inReplyToId?: string | null;
}): Promise<ScoutCardContext | null> {
  const userId = requireEvidenceUserId(opts.userId);
  const targetId = optionalId(opts.targetId);
  let snapshot: LastScoutSnapshot | null = null;
  try {
    snapshot = await getLastScout({ userId });
  } catch (err) {
    console.warn("scout evidence tank read soft-fail:", err);
  }
  if (targetId) {
    const exactCard = cardContextFromSnapshot(snapshot, { targetId });
    if (exactCard?.cardId === targetId) return exactCard;
    const exact = readRetainedTargetContext(userId, targetId);
    if (exact) return contextFromRetained(exact, targetId);
  }
  const fromTank = cardContextFromSnapshot(snapshot, {
    targetId,
    conversationId: opts.conversationId,
    inReplyToId: opts.inReplyToId,
  });
  if (fromTank) return fromTank;
  for (const conversation of [opts.conversationId, opts.inReplyToId]) {
    const id = optionalId(conversation);
    if (!id) continue;
    const retained = readRetainedContextByConversation(userId, id);
    if (retained) return contextFromRetained(retained, targetId);
  }
  if (targetId) {
    const watched = getWatchedThread(userId, targetId);
    if (watched) {
      return {
        targetId,
        cardId: watched.threadId,
        conversationId: watched.conversationId,
        parentId: null,
        threadKind: null,
        targetAuthor: normalizeEvidenceAuthor(watched.author),
        topics: tokenizeScoutTopics(watched.text),
        contextSource: "watch",
      };
    }
  }
  return null;
}

/**
 * Retain server-owned context for a watched / locked target. Kind comes only
 * from the user's own tank card; body-supplied author/text are fallbacks for
 * author and topics, never for kind.
 */
export async function retainScoutContextForTarget(opts: {
  userId: string;
  targetId: string;
  conversationId?: string | null;
  inReplyToId?: string | null;
  fallbackAuthor?: string | null;
  fallbackText?: string | null;
  source: "watch" | "lock";
  nowMs?: number;
  snapshot?: LastScoutSnapshot | null;
}): Promise<RetainedTargetContext | null> {
  const userId = requireEvidenceUserId(opts.userId);
  const targetId = optionalId(opts.targetId);
  if (!targetId) return null;
  let snapshot = opts.snapshot;
  if (!("snapshot" in opts)) {
    snapshot = null;
    try {
      snapshot = await getLastScout({ userId });
    } catch (err) {
      console.warn("scout evidence tank read soft-fail:", err);
    }
  }
  const card = cardContextFromSnapshot(snapshot, {
    targetId,
    conversationId: opts.conversationId,
    inReplyToId: opts.inReplyToId,
  });
  return retainScoutTargetContext({
    userId,
    targetId,
    cardId: card?.cardId ?? null,
    conversationId: card?.conversationId ?? optionalId(opts.conversationId),
    inReplyToId: card?.parentId ?? optionalId(opts.inReplyToId),
    author: card?.targetAuthor ?? normalizeEvidenceAuthor(opts.fallbackAuthor),
    threadKind: card?.threadKind ?? null,
    topics: card?.topics.length
      ? card.topics
      : tokenizeScoutTopics(opts.fallbackText),
    contextSource: card ? "scout_cache" : opts.source,
    nowMs: opts.nowMs,
  });
}

/** Evidence fields from a resolved context, or all-unknown when absent. */
export function evidenceContextFields(
  context: ScoutCardContext | null,
): ScoutEvidenceContext {
  if (!context) {
    return {
      cardId: null,
      conversationId: null,
      parentId: null,
      threadKind: null,
      targetAuthor: null,
      topics: [],
      contextSource: null,
    };
  }
  return {
    cardId: context.cardId,
    conversationId: context.conversationId,
    parentId: context.parentId,
    threadKind: context.threadKind,
    targetAuthor: context.targetAuthor,
    topics: context.topics,
    contextSource: context.contextSource,
  };
}

function parseRetainedRow(value: unknown): RetainedRow | undefined {
  const valid = (row: unknown): row is RetainedRow | undefined =>
    (row === undefined || (isRecord(row) &&
    typeof row.target_id === "string" &&
    (row.card_id === null || typeof row.card_id === "string") &&
    (row.conversation_id === null || typeof row.conversation_id === "string") &&
    (row.in_reply_to_id === null || typeof row.in_reply_to_id === "string") &&
    (row.author === null || typeof row.author === "string") &&
    (row.thread_kind === null || typeof row.thread_kind === "string") &&
    (row.topics_json === null || typeof row.topics_json === "string") &&
    typeof row.context_source === "string" &&
    typeof row.retained_at === "string"));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseRetainedRow2(value: unknown): RetainedRow[] {
  const valid = (row: unknown): row is RetainedRow[] =>
    (Array.isArray(row) && row.every((item: unknown) => (isRecord(item) &&
    typeof item.target_id === "string" &&
    (item.card_id === null || typeof item.card_id === "string") &&
    (item.conversation_id === null || typeof item.conversation_id === "string") &&
    (item.in_reply_to_id === null || typeof item.in_reply_to_id === "string") &&
    (item.author === null || typeof item.author === "string") &&
    (item.thread_kind === null || typeof item.thread_kind === "string") &&
    (item.topics_json === null || typeof item.topics_json === "string") &&
    typeof item.context_source === "string" &&
    typeof item.retained_at === "string")));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}
