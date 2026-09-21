/**
 * Thin helpers for HTTP / webhook / Voice adapters: capture server-owned
 * context before prune, then build the evidence payload for store transactions.
 */
import type { ActionEvidenceInput } from "../desk/interactionStore.js";
import {
  captureScoutTargetContext,
  evidenceContextFields,
  normalizeEvidenceAuthor,
  tokenizeScoutTopics,
} from "./scoutEvidenceContext.js";
import {
  explicitEventKey,
  takeEventKey,
  type ScoutEvidenceNoteState,
  type ScoutEvidenceSource,
} from "./scoutEvidence.js";

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
  const context = await captureScoutTargetContext({
    userId: opts.userId,
    targetId,
    conversationId: opts.conversationId,
    inReplyToId: opts.inReplyToId,
  });
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
  const context = await captureScoutTargetContext({
    userId: opts.userId,
    targetId,
    conversationId: opts.conversationId,
    inReplyToId: opts.inReplyToId,
  });
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
