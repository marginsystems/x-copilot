/**
 * Thin helpers for HTTP / webhook / Voice adapters: capture server-owned
 * context before prune, then build the evidence payload for store transactions.
 *
 * A context read failure is a soft failure: the payload is still built with
 * unknown context and the adapter's permitted fallback fields, so an explicit
 * action or confirmed take is never dropped for want of a tank card. Evidence
 * persistence errors are not caught here; they belong to the store transaction.
 */
import type { ActionEvidenceInput } from "./scoutEvidence.js";
import {
  captureScoutTargetContext,
  evidenceContextFields,
  normalizeEvidenceAuthor,
  tokenizeScoutTopics,
  type ScoutCardContext,
} from "./scoutEvidenceContext.js";
import {
  explicitEventKey,
  takeEventKey,
  type ScoutEvidenceNoteState,
  type ScoutEvidenceSource,
} from "./scoutEvidence.js";

async function captureContextOrUnknown(
  opts: Parameters<typeof captureScoutTargetContext>[0],
  label: string,
): Promise<ScoutCardContext | null> {
  try {
    return await captureScoutTargetContext(opts);
  } catch (err) {
    console.warn(`${label} evidence context read soft-fail (unknown context):`, err);
    return null;
  }
}

export async function explicitScoutActionEvidence(opts: {
  userId: string;
  action: "skip" | "dismiss";
  surface: "scout" | "for-you";
  cardId: string;
  source: ScoutEvidenceSource;
  targetId?: string | null;
  conversationId?: string | null;
  inReplyToId?: string | null;
  fallbackText?: string | null;
  fallbackAuthor?: string | null;
}): Promise<ActionEvidenceInput> {
  const cardId = opts.cardId.trim();
  const targetId = opts.targetId?.trim() || cardId;
  const context = await captureContextOrUnknown(
    {
      userId: opts.userId,
      targetId,
      conversationId: opts.conversationId,
      inReplyToId: opts.inReplyToId,
    },
    `Scout ${opts.action}`,
  );
  const fields = evidenceContextFields(context);
  return {
    eventKey: explicitEventKey(opts.action, opts.surface, cardId),
    source: opts.source,
    targetId,
    replyId: null,
    cardId: fields.cardId ?? cardId,
    conversationId: fields.conversationId ?? opts.conversationId ?? null,
    parentId: fields.parentId ?? opts.inReplyToId ?? null,
    threadKind: fields.threadKind ?? null,
    targetAuthor:
      fields.targetAuthor ?? normalizeEvidenceAuthor(opts.fallbackAuthor),
    topics: fields.topics?.length
      ? [...fields.topics]
      : tokenizeScoutTopics(opts.fallbackText),
    contextSource: fields.contextSource,
  };
}

export async function confirmedTakeEvidence(opts: {
  userId: string;
  replyId: string;
  targetId: string;
  source: ScoutEvidenceSource;
  conversationId?: string | null;
  inReplyToId?: string | null;
  noteState?: ScoutEvidenceNoteState;
  fallbackText?: string | null;
  fallbackAuthor?: string | null;
}): Promise<ActionEvidenceInput> {
  const replyId = opts.replyId.trim();
  const targetId = opts.targetId.trim();
  const context = await captureContextOrUnknown(
    {
      userId: opts.userId,
      targetId,
      conversationId: opts.conversationId,
      inReplyToId: opts.inReplyToId,
    },
    "Scout take",
  );
  const fields = evidenceContextFields(context);
  return {
    eventKey: takeEventKey(replyId),
    source: opts.source,
    targetId,
    replyId,
    cardId: fields.cardId,
    conversationId: fields.conversationId ?? opts.conversationId ?? null,
    parentId: fields.parentId ?? opts.inReplyToId ?? null,
    threadKind: fields.threadKind ?? null,
    targetAuthor:
      fields.targetAuthor ?? normalizeEvidenceAuthor(opts.fallbackAuthor),
    topics: fields.topics?.length
      ? [...fields.topics]
      : tokenizeScoutTopics(opts.fallbackText),
    contextSource: fields.contextSource,
    noteState: opts.noteState ?? "unknown",
  };
}
