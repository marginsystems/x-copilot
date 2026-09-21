/**
 * Bounded, resumable Scout evidence reconciliation.
 *
 * Rebuilds take evidence from durable local facts only — desk interactions
 * that carry a reply id, confirmed own_posts reply text, and owner-verified
 * notes — in keyset pages so the 200-post discovery window cannot strand
 * older observations. Idempotent: rows already present are only enriched,
 * the revision moves only on a material change, and nothing here posts to
 * X, reads X, awards XP, or schedules a worker. Called from the existing
 * discovery pass and reusable by C10 read repair.
 */
import {
  listConfirmedOwnRepliesPage,
  type ConfirmedOwnReply,
} from "../desk/ownPostStore.js";
import {
  listInteractionRowsPage,
  type Interaction,
} from "../desk/interactionStore.js";
import { defaultKnowledgeRoot } from "../memory/knowledgeMemory.js";
import {
  OwnedNoteCache,
  listNoteNames,
  ownedNoteDir,
  resolveOwnedNote,
} from "../memory/ownedMemoryNotes.js";
import {
  captureScoutTargetContext,
  evidenceContextFields,
  normalizeEvidenceAuthor,
} from "./scoutEvidenceContext.js";
import {
  findScoutTakeByReplyId,
  listScoutEvidenceNeedingNoteCheck,
  readScoutEvidenceCursor,
  recordScoutEvidence,
  requireEvidenceUserId,
  setScoutEvidenceNoteState,
  takeEventKey,
  writeScoutEvidenceCursor,
  type ScoutEvidenceNoteState,
  type ScoutEvidenceRow,
} from "./scoutEvidence.js";

export const DEFAULT_RECONCILE_BATCH = 200;
const MAX_RECONCILE_BATCH = 500;

const SCOPE_INTERACTIONS = "interactions";
const SCOPE_OWN_REPLIES = "own_replies";
const SCOPE_NOTES = "notes";

type InteractionCursor = { at: string; threadId: string };
type OwnReplyCursor = { postedAt: string; id: string };
type NoteCursor = { actedAt: string; eventKey: string };

export type ScoutEvidenceReconcileResult = {
  userId: string;
  scanned: { interactions: number; ownReplies: number; notes: number };
  inserted: number;
  enriched: number;
  notesVerified: number;
  /** True when every scope wrapped back to its newest row this pass. */
  complete: boolean;
};

export type OwnedReplyNoteCheck = {
  state: Exclude<ScoutEvidenceNoteState, "unknown">;
  /** Confirmed reply text from the note when it verifies for this reply. */
  reply: string | null;
};

function noteReplyId(frontmatter: string): string | null {
  const m = /^replyId:\s*["']?([^"'\r\n]+)["']?\s*$/m.exec(frontmatter);
  return m?.[1]?.trim() || null;
}

/**
 * Stored-reply credit requires this owner's verified note for the thread
 * with a nonempty reply and either a matching reply id or no reply id at
 * all (legacy note joined to the user's own durable confirmed record).
 */
export async function verifyOwnedReplyNote(opts: {
  userId: string;
  threadId: string;
  replyId: string;
  at?: string;
  knowledgeRoot: string;
  cache?: OwnedNoteCache;
  names?: string[] | null;
}): Promise<OwnedReplyNoteCheck> {
  let resolved;
  try {
    resolved = await resolveOwnedNote({
      kind: "interaction",
      userId: opts.userId,
      threadId: opts.threadId,
      at: opts.at,
      replyId: opts.replyId,
      knowledgeRoot: opts.knowledgeRoot,
      allowOtherDates: true,
      cache: opts.cache,
      names: opts.names,
    });
  } catch {
    return { state: "missing", reply: null };
  }
  if (resolved.state !== "found") return { state: "missing", reply: null };
  const reply = resolved.meta.reply.trim();
  if (!reply) return { state: "missing", reply: null };
  const declared = noteReplyId(resolved.meta.frontmatter);
  if (declared !== null && declared !== opts.replyId.trim()) {
    return { state: "missing", reply: null };
  }
  return { state: "stored", reply };
}

function clampBatch(batchSize: number | undefined): number {
  const n = Math.floor(batchSize ?? DEFAULT_RECONCILE_BATCH);
  return Math.min(Math.max(Number.isFinite(n) ? n : DEFAULT_RECONCILE_BATCH, 1), MAX_RECONCILE_BATCH);
}

type PassState = {
  userId: string;
  nowMs: number;
  knowledgeRoot: string;
  cache: OwnedNoteCache;
  names: string[] | null;
  result: ScoutEvidenceReconcileResult;
};

async function recordConfirmedTake(
  state: PassState,
  facts: {
    replyId: string;
    targetId: string | null;
    conversationId: string | null;
    parentId: string | null;
    actedAt: string;
    threadId: string;
    fallbackAuthor: string | null;
  },
): Promise<void> {
  const note = await verifyOwnedReplyNote({
    userId: state.userId,
    threadId: facts.threadId,
    replyId: facts.replyId,
    at: facts.actedAt,
    knowledgeRoot: state.knowledgeRoot,
    cache: state.cache,
    names: state.names,
  });
  const context = await captureScoutTargetContext({
    userId: state.userId,
    targetId: facts.targetId ?? facts.threadId,
    conversationId: facts.conversationId,
    inReplyToId: facts.parentId,
  });
  const fields = evidenceContextFields(context);
  const existed = findScoutTakeByReplyId(state.userId, facts.replyId) !== null;
  const outcome = recordScoutEvidence({
    userId: state.userId,
    eventKey: takeEventKey(facts.replyId),
    action: "take",
    source: "reconcile",
    targetId: facts.targetId ?? facts.threadId,
    replyId: facts.replyId,
    actedAt: facts.actedAt,
    ...fields,
    conversationId: fields.conversationId ?? facts.conversationId,
    parentId: fields.parentId ?? facts.parentId,
    targetAuthor:
      fields.targetAuthor ?? normalizeEvidenceAuthor(facts.fallbackAuthor),
    noteState: note.state,
    nowMs: state.nowMs,
  });
  if (!outcome.changed) return;
  if (existed) state.result.enriched += 1;
  else state.result.inserted += 1;
}

function confirmedOwnReplyText(
  userId: string,
  replyId: string,
): ConfirmedOwnReply | null {
  const page = listConfirmedOwnRepliesPage({
    userId,
    limit: 1,
    replyId,
    excludeSelfReplies: true,
  });
  return page[0] ?? null;
}

async function reconcileInteractions(
  state: PassState,
  batch: number,
): Promise<boolean> {
  const cursor = readScoutEvidenceCursor<InteractionCursor>(
    state.userId,
    SCOPE_INTERACTIONS,
  );
  const rows: Interaction[] = listInteractionRowsPage({
    userId: state.userId,
    limit: batch,
    withReplyId: true,
    before: cursor ?? undefined,
  });
  state.result.scanned.interactions += rows.length;
  for (const row of rows) {
    const replyId = row.replyId?.trim();
    if (!replyId) continue;
    const actedAt = row.postedAt ?? row.at;
    // URL-only marks are takes only once confirmed reply text exists locally.
    const ownReply = confirmedOwnReplyText(state.userId, replyId);
    let confirmed = ownReply !== null;
    if (!confirmed) {
      const note = await verifyOwnedReplyNote({
        userId: state.userId,
        threadId: row.threadId,
        replyId,
        at: actedAt,
        knowledgeRoot: state.knowledgeRoot,
        cache: state.cache,
        names: state.names,
      });
      confirmed = note.state === "stored";
    }
    if (!confirmed) continue;
    await recordConfirmedTake(state, {
      replyId,
      targetId: row.threadId,
      conversationId: row.conversationId ?? ownReply?.conversationId ?? null,
      parentId: row.inReplyToId ?? ownReply?.inReplyToId ?? null,
      actedAt,
      threadId: row.threadId,
      fallbackAuthor: row.author,
    });
  }
  const last = rows[rows.length - 1];
  const wrapped = rows.length < batch || !last;
  writeScoutEvidenceCursor(
    state.userId,
    SCOPE_INTERACTIONS,
    wrapped ? null : { at: last.at, threadId: last.threadId },
    state.nowMs,
  );
  return wrapped;
}

async function reconcileOwnReplies(
  state: PassState,
  batch: number,
): Promise<boolean> {
  const cursor = readScoutEvidenceCursor<OwnReplyCursor>(
    state.userId,
    SCOPE_OWN_REPLIES,
  );
  const posts = listConfirmedOwnRepliesPage({
    userId: state.userId,
    limit: batch,
    before: cursor ?? undefined,
    excludeSelfReplies: true,
  });
  state.result.scanned.ownReplies += posts.length;
  for (const post of posts) {
    const targetId = post.inReplyToId;
    if (!targetId) continue;
    const existing = findScoutTakeByReplyId(state.userId, post.id);
    // Adapter-recorded takes with full facts need no own_posts pass here;
    // the notes scope repairs their stored-note state.
    if (existing && existing.threadKind !== null && existing.noteState === "stored") {
      continue;
    }
    await recordConfirmedTake(state, {
      replyId: post.id,
      targetId,
      conversationId: post.conversationId,
      parentId: targetId,
      actedAt: post.postedAt,
      threadId: targetId,
      fallbackAuthor: null,
    });
  }
  const last = posts[posts.length - 1];
  const wrapped = posts.length < batch || !last;
  writeScoutEvidenceCursor(
    state.userId,
    SCOPE_OWN_REPLIES,
    wrapped ? null : { postedAt: last.postedAt, id: last.id },
    state.nowMs,
  );
  return wrapped;
}

function takesNeedingNoteCheck(
  userId: string,
  cursor: NoteCursor | null,
  batch: number,
): ScoutEvidenceRow[] {
  return listScoutEvidenceNeedingNoteCheck({
    userId,
    before: cursor ?? undefined,
    limit: batch,
  });
}

async function reconcileNotes(state: PassState, batch: number): Promise<boolean> {
  const cursor = readScoutEvidenceCursor<NoteCursor>(state.userId, SCOPE_NOTES);
  const rows = takesNeedingNoteCheck(state.userId, cursor, batch);
  state.result.scanned.notes += rows.length;
  for (const row of rows) {
    const threadId = row.targetId ?? row.parentId;
    if (!threadId || !row.replyId) continue;
    const note = await verifyOwnedReplyNote({
      userId: state.userId,
      threadId,
      replyId: row.replyId,
      at: row.actedAt,
      knowledgeRoot: state.knowledgeRoot,
      cache: state.cache,
      names: state.names,
    });
    const changed = setScoutEvidenceNoteState({
      userId: state.userId,
      replyId: row.replyId,
      state: note.state,
      nowMs: state.nowMs,
    });
    if (changed) state.result.notesVerified += 1;
  }
  const last = rows[rows.length - 1];
  const wrapped = rows.length < batch || !last;
  writeScoutEvidenceCursor(
    state.userId,
    SCOPE_NOTES,
    wrapped ? null : { actedAt: last.actedAt, eventKey: last.eventKey },
    state.nowMs,
  );
  return wrapped;
}

/**
 * One bounded pass for one user. Each call advances three keyset cursors
 * (interactions with reply ids, confirmed own replies, takes awaiting note
 * verification) by at most `batchSize` rows and wraps them to the newest row
 * once exhausted, so repeated calls cover every durable fact.
 */
export async function reconcileScoutEvidence(opts: {
  userId: string;
  batchSize?: number;
  nowMs?: number;
  knowledgeRoot?: string;
}): Promise<ScoutEvidenceReconcileResult> {
  const userId = requireEvidenceUserId(opts.userId);
  const batch = clampBatch(opts.batchSize);
  const knowledgeRoot = opts.knowledgeRoot ?? defaultKnowledgeRoot();
  const cache = new OwnedNoteCache();
  const names = await listNoteNames(ownedNoteDir("interaction", knowledgeRoot), cache);
  const state: PassState = {
    userId,
    nowMs: opts.nowMs ?? Date.now(),
    knowledgeRoot,
    cache,
    names,
    result: {
      userId,
      scanned: { interactions: 0, ownReplies: 0, notes: 0 },
      inserted: 0,
      enriched: 0,
      notesVerified: 0,
      complete: false,
    },
  };
  const wrapped = [
    await reconcileInteractions(state, batch),
    await reconcileOwnReplies(state, batch),
    await reconcileNotes(state, batch),
  ];
  state.result.complete = wrapped.every(Boolean);
  return state.result;
}
