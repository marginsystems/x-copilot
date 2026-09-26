import { postUrl, type ParsedPostCreate } from "../x-api/xActivity.js";
import { getWatchedThread } from "./ownPostStore.js";
import {
  listInteractionHistory,
  markInteracted,
  MAX_INTERACTION_STORE,
} from "./interactionStore.js";
import { recordDeskReplyMarked } from "./deskBeats.js";
import { deskInteractedPayload, type DeskInteractedPayload } from "./deskEvents.js";
import { recordMarkGamification } from "./gamification.js";
import { setGamificationSyncFailed } from "./interactionSync.js";
import { replyMatchesLockedScout } from "../scout/replyMatchScout.js";
import { getScoutApproachLock } from "../scout/scoutApproachLock.js";
import { pruneConsumedScoutThread } from "../scout/scoutCache.js";
import {
  projectConfirmedReplyMemory,
  type ProjectConfirmedReplyMemoryInput,
} from "../memory/interactionMemoryProjection.js";
import { defaultKnowledgeRoot } from "../memory/knowledgeMemory.js";
import { resolveOwnedNote } from "../memory/ownedMemoryNotes.js";
import { confirmedTakeEvidence } from "../scout/scoutEvidenceRecord.js";

export type OwnReplyMemoryOpts = Pick<
  ProjectConfirmedReplyMemoryInput,
  "knowledgeRoot" | "indexDir" | "awaitUpsert" | "upsertMemory"
>;

export type MarkOwnReplyOpts = {
  nowMs?: number;
  publishInteracted?: (interaction: DeskInteractedPayload) => void;
} & OwnReplyMemoryOpts;

function optionalContext(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function memoryOpts(opts?: OwnReplyMemoryOpts): OwnReplyMemoryOpts {
  return {
    knowledgeRoot: opts?.knowledgeRoot,
    indexDir: opts?.indexDir,
    awaitUpsert: opts?.awaitUpsert,
    upsertMemory: opts?.upsertMemory,
  };
}

async function projectOwnReplyMemory(
  input: {
    userId: string;
    reply: string;
    threadId: string;
    author: string;
    interactedAt: string;
    replyId?: string;
    url?: string;
    text?: string;
    summary?: string;
  } & OwnReplyMemoryOpts,
): Promise<void> {
  try {
    await projectConfirmedReplyMemory({
      userId: input.userId,
      reply: input.reply,
      threadId: input.threadId,
      author: input.author,
      interactedAt: input.interactedAt,
      replyId: input.replyId,
      source: "discovered",
      url: input.url,
      text: input.text,
      summary: input.summary,
      knowledgeRoot: input.knowledgeRoot,
      indexDir: input.indexDir,
      awaitUpsert: input.awaitUpsert,
      upsertMemory: input.upsertMemory,
    });
  } catch (err) {
    console.warn("[xaa] confirmed-reply memory soft-fail", err);
  }
}

export async function markOwnReplyInteracted(
  parsed: ParsedPostCreate,
  userId: string,
  opts?: MarkOwnReplyOpts,
): Promise<"scout" | "organic" | "skipped"> {
  const isReply = parsed.kind === "reply" && Boolean(parsed.inReplyToId);
  if (!isReply) return "skipped";
  if (parsed.inReplyToUserId === parsed.xUserId) return "skipped";
  const targetId = parsed.inReplyToId!;
  const locked = getScoutApproachLock(userId, opts?.nowMs);
  const watched =
    getWatchedThread(userId, targetId) ??
    (parsed.conversationId
      ? getWatchedThread(userId, parsed.conversationId)
      : null);
  const matchedLock =
    !watched &&
    locked &&
    replyMatchesLockedScout(
      {
        inReplyToId: targetId,
        conversationId: parsed.conversationId,
      },
      locked,
    )
      ? locked
      : null;
  const scoutCard = watched ?? matchedLock;
  const threadId =
    watched?.threadId ??
    matchedLock?.id ??
    targetId ??
    parsed.conversationId ??
    parsed.postId;
  const author =
    scoutCard?.author ??
    (parsed.inReplyToUsername
      ? `@${parsed.inReplyToUsername.replace(/^@+/, "")}`
      : parsed.inReplyToUserId
        ? `@${parsed.inReplyToUserId}`
        : "@unknown");
  const contextUrl =
    optionalContext(scoutCard?.url) ??
    (parsed.inReplyToUsername
      ? postUrl(parsed.inReplyToUsername, targetId)
      : undefined);
  const contextText = optionalContext(scoutCard?.text);
  const history = await listInteractionHistory({
    limit: MAX_INTERACTION_STORE,
    userId,
  });
  const known = history.find((row) => row.replyId === parsed.postId) ??
    history.find(
      (row) =>
        !row.replyId &&
        (parsed.inReplyToId === row.threadId ||
          parsed.conversationId === row.threadId),
    );
  if (known) {
    let noteOwned = false;
    try {
      const resolved = await resolveOwnedNote({
        kind: "interaction",
        userId,
        threadId: known.threadId,
        at: known.postedAt ?? known.at,
        replyId: parsed.postId,
        knowledgeRoot: opts?.knowledgeRoot ?? defaultKnowledgeRoot(),
      });
      noteOwned = resolved.state === "found" && resolved.meta.reply.length > 0;
    } catch {
      noteOwned = false;
    }
    if (!noteOwned) {
      await projectOwnReplyMemory({
        userId,
        reply: parsed.text,
        threadId: known.threadId,
        author: known.author || author,
        interactedAt: known.postedAt ?? known.at,
        replyId: parsed.postId,
        url: contextUrl ?? known.url,
        text: contextText ?? known.text,
        summary: known.summary,
        ...memoryOpts(opts),
      });
    }
    return "skipped";
  }
  const source = scoutCard ? "scout" : "organic";
  let evidence: Awaited<ReturnType<typeof confirmedTakeEvidence>> | undefined;
  try {
    evidence = await confirmedTakeEvidence({
      userId,
      replyId: parsed.postId,
      targetId: threadId,
      source: "webhook",
      conversationId: parsed.conversationId ?? scoutCard?.conversationId ?? null,
      inReplyToId: targetId,
      fallbackText: contextText ?? parsed.text,
      fallbackAuthor: author,
    });
  } catch (err) {
    console.warn("[xaa] scout evidence capture soft-fail", err);
  }
  let interaction;
  try {
    interaction = await markInteracted({
      threadId,
      author,
      source: "discovered",
      userId,
      url: contextUrl,
      text: contextText,
      replyId: parsed.postId,
      replyUrl: postUrl(parsed.authorUsername, parsed.postId),
      postedAt: parsed.postedAt,
      conversationId:
        parsed.conversationId ?? scoutCard?.conversationId ?? undefined,
      inReplyToId: targetId,
      nowMs: opts?.nowMs,
      evidence,
    });
  } catch (err) {
    console.warn("[xaa] mark after post soft-fail (post already on X):", err);
    throw err;
  }
  const deskEvent = deskInteractedPayload(interaction);
  if (deskEvent) opts?.publishInteracted?.(deskEvent);
  try {
    await pruneConsumedScoutThread(userId, [
      interaction.threadId,
      interaction.conversationId,
      interaction.inReplyToId,
    ]);
  } catch (err) {
    console.warn("[xaa] scout tank prune soft-fail", err);
  }
  recordDeskReplyMarked({
    userId,
    source,
    nowMs: opts?.nowMs,
  });
  if (scoutCard) {
    try {
      await recordMarkGamification({
        threadId,
        userId,
        nowMs: opts?.nowMs ?? Date.parse(interaction.at),
      });
    } catch (err) {
      console.warn("[xaa] streak mark soft-fail", err);
      await setGamificationSyncFailed({
        threadId,
        userId,
        checkpoint: "mark",
        failed: true,
        pendingAt: interaction.at,
      }).catch(() => {});
    }
  }
  await projectOwnReplyMemory({
    userId,
    reply: parsed.text,
    threadId: interaction.threadId,
    author: interaction.author || author,
    interactedAt: interaction.postedAt ?? interaction.at,
    replyId: parsed.postId,
    url: interaction.url ?? contextUrl,
    text: contextText ?? interaction.text,
    summary: interaction.summary,
    ...memoryOpts(opts),
  });
  return source;
}
