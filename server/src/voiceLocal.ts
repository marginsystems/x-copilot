/**
 * Local voice corpus: interacted memories first, then Activity own_posts.
 * The X API is a fill-in only — call this before any timeline pull.
 */
import { countPlatformUsers } from "./authStore.js";
import { MAX_INTERACTION_STORE, listInteractionHistory } from "./interactionStore.js";
import {
  listInteractionMemoryReplies,
  type MemoryReplyInput,
} from "./knowledgeMemory.js";
import {
  foldDeskReplies,
  foldMemoryReplies,
  refreshVoiceCounts,
  type VoiceReplyInput,
} from "./voiceStore.js";

export function memoryRepliesToVoiceInputs(
  notes: MemoryReplyInput[],
  history: Array<{
    threadId: string;
    replyId?: string;
    conversationId?: string;
    inReplyToId?: string;
    postedAt?: string;
    at?: string;
  }>,
): VoiceReplyInput[] {
  const byThread = new Map(history.map((row) => [row.threadId, row]));
  return notes.map((note) => {
    const hit = byThread.get(note.threadId);
    return {
      id: hit?.replyId?.trim() || `mem:${note.threadId}`,
      text: note.text,
      conversationId: hit?.conversationId?.trim() || note.threadId,
      inReplyToId: hit?.inReplyToId?.trim() || note.threadId,
      postedAt: note.postedAt ?? hit?.postedAt ?? hit?.at ?? null,
      source: "memory" as const,
    };
  });
}

/**
 * Fold desk-detected own_posts + knowledge interaction notes into voice_replies.
 * Returns how many new rows were inserted.
 */
export async function foldLocalVoiceSources(
  userId: string,
  opts?: { knowledgeRoot?: string; storePath?: string },
): Promise<number> {
  const desk = foldDeskReplies(userId);
  const [notes, history] = await Promise.all([
    listInteractionMemoryReplies({
      knowledgeRoot: opts?.knowledgeRoot,
      userId,
      // Single-user sidecar: fold pre-PR and hourly-discovered notes that carry
      // no userId, or the unlock bar is unreachable for that persona. In
      // multi-user installs unowned notes stay excluded from every corpus.
      includeUnowned: countPlatformUsers() === 1,
    }),
    listInteractionHistory({
      storePath: opts?.storePath,
      limit: MAX_INTERACTION_STORE,
      userId,
    }),
  ]);
  const memory = foldMemoryReplies(
    userId,
    memoryRepliesToVoiceInputs(notes, history),
  );
  refreshVoiceCounts(userId);
  return desk + memory;
}
