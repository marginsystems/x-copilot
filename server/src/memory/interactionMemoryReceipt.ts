/**
 * Bounded owner-verified saved-memory receipts for desk history and boot.
 * Saved means this user's matching note exists with confirmed reply text —
 * not that MiniLM indexed it. Resolution goes through the owned-note
 * resolver so canonical and verified legacy paths both count.
 */
import type { ConfirmedReplyMemoryState } from "./interactionMemoryProjection.js";
import { defaultKnowledgeRoot } from "./knowledgeMemory.js";
import {
  OwnedNoteCache,
  listNoteNames,
  ownedNoteDir,
  resolveOwnedNote,
} from "./ownedMemoryNotes.js";

export type InteractionMemoryReceipt = {
  state: ConfirmedReplyMemoryState;
};

export type InteractionMemoryLookupKey = {
  threadId: string;
  at: string;
  postedAt?: string;
  replyId?: string;
};

let testKnowledgeRoot: string | undefined;
const cache = new OwnedNoteCache();

export function resetInteractionMemoryReceiptForTests(opts?: {
  knowledgeRoot?: string;
}): void {
  testKnowledgeRoot = opts?.knowledgeRoot;
  cache.clear();
}

function resolveKnowledgeRoot(explicit?: string): string {
  return explicit ?? testKnowledgeRoot ?? defaultKnowledgeRoot();
}

/**
 * One directory listing plus bounded note reads per returned interaction. Never throws.
 */
export async function lookupInteractionMemoryReceipts(opts: {
  userId: string;
  interactions: readonly InteractionMemoryLookupKey[];
  knowledgeRoot?: string;
}): Promise<ConfirmedReplyMemoryState[]> {
  const userId = opts.userId.trim();
  if (!userId) {
    return opts.interactions.map(() => "unavailable");
  }
  const knowledgeRoot = resolveKnowledgeRoot(opts.knowledgeRoot);
  const names = await listNoteNames(
    ownedNoteDir("interaction", knowledgeRoot),
    cache,
  );
  if (!names) {
    return opts.interactions.map(() => "unavailable");
  }

  const states = new Array<ConfirmedReplyMemoryState>(opts.interactions.length);
  const batchSize = 20;
  for (let start = 0; start < opts.interactions.length; start += batchSize) {
    const batch = await Promise.all(
      opts.interactions.slice(start, start + batchSize).map(async (interaction) => {
        try {
          const resolved = await resolveOwnedNote({
            kind: "interaction",
            userId,
            threadId: interaction.threadId,
            at: interaction.postedAt ?? interaction.at,
            replyId: interaction.replyId,
            knowledgeRoot,
            cache,
            names,
          });
          if (resolved.state === "missing") return "no_reply_text" as const;
          if (resolved.state === "found" && resolved.meta.reply) {
            return "saved" as const;
          }
          // Wrong owner, unowned, ambiguous, unreadable, or a note without
          // usable reply text is not saved for this user. Do not treat a
          // foreign note as "no reply".
          return "unavailable" as const;
        } catch {
          return "unavailable" as const;
        }
      }),
    );
    states.splice(start, batch.length, ...batch);
  }
  return states;
}

export async function attachInteractionMemoryReceipts<
  T extends InteractionMemoryLookupKey,
>(
  interactions: readonly T[],
  opts: { userId: string; knowledgeRoot?: string },
): Promise<Array<T & { memory: InteractionMemoryReceipt }>> {
  try {
    const states = await lookupInteractionMemoryReceipts({
      userId: opts.userId,
      interactions,
      knowledgeRoot: opts.knowledgeRoot,
    });
    return interactions.map((row, i) => ({
      ...row,
      memory: { state: states[i] ?? "unavailable" },
    }));
  } catch {
    return interactions.map((row) => ({
      ...row,
      memory: { state: "unavailable" as const },
    }));
  }
}
