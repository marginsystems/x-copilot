/**
 * Shared confirmed-reply memory projection.
 * Saved means the note was written. MiniLM upsert is attempted or scheduled
 * and never changes the receipt.
 */
import {
  FOREIGN_NOTE_ERROR,
  normalizeReply,
  writeInteractionMemory,
  type InteractionMemoryInput,
} from "./knowledgeMemory.js";
import {
  upsertMemoryNote,
  type Embedder,
  type MemoryType,
} from "./memoryIndex.js";
import { scheduleMemoryUpsert } from "./memoryReindex.js";

export type ConfirmedReplyMemoryState =
  | "saved"
  | "unavailable"
  | "no_reply_text";

export type ConfirmedReplyMemoryResult = {
  state: ConfirmedReplyMemoryState;
  memoryPath?: string;
};

export type ProjectConfirmedReplyMemoryInput = {
  userId: string;
  /** Confirmed reply body only. Parent or detector text belongs in `text`. */
  reply: unknown;
  threadId: string;
  author: string;
  interactedAt: string;
  source?: InteractionMemoryInput["source"];
  url?: string;
  text?: string;
  summary?: string;
  opAuthor?: string;
  opText?: string;
  agenda?: string;
  baitScore?: number;
  engage?: string;
  flags?: string[];
  intent?: string;
  reason?: string;
  knowledgeRoot?: string;
  indexDir?: string;
  embedder?: Embedder;
  /** When false, skip MiniLM after the note write. Default true. */
  upsertMemory?: boolean;
  /** Await upsert so callers can observe MiniLM. Default: schedule. */
  awaitUpsert?: boolean;
};

type ProjectionDeps = {
  writeNote: (
    input: InteractionMemoryInput,
  ) => Promise<{ path: string }>;
  upsertNote: typeof upsertMemoryNote;
  scheduleUpsert: (
    notePath: string,
    type: MemoryType,
  ) => void | Promise<void>;
};

const defaultDeps: ProjectionDeps = {
  writeNote: writeInteractionMemory,
  upsertNote: upsertMemoryNote,
  scheduleUpsert: scheduleMemoryUpsert,
};

let deps: ProjectionDeps = { ...defaultDeps };

export function resetInteractionMemoryProjectionForTests(
  overrides?: Partial<ProjectionDeps>,
): void {
  deps = { ...defaultDeps, ...overrides };
}

export async function projectConfirmedReplyMemory(
  input: ProjectConfirmedReplyMemoryInput,
): Promise<ConfirmedReplyMemoryResult> {
  const reply = normalizeReply(input.reply);
  if (!reply) return { state: "no_reply_text" };
  const userId = typeof input.userId === "string" ? input.userId.trim() : "";
  if (!userId) {
    // New notes are never unowned: no owner means no write, not a legacy note.
    console.warn("confirmed-reply memory skipped: missing userId");
    return { state: "unavailable" };
  }

  try {
    const memory = await deps.writeNote({
      threadId: input.threadId,
      author: input.author,
      reply,
      source: input.source,
      userId,
      url: input.url,
      text: input.text,
      summary: input.summary,
      opAuthor: input.opAuthor,
      opText: input.opText,
      agenda: input.agenda,
      baitScore: input.baitScore,
      engage: input.engage,
      flags: input.flags,
      intent: input.intent,
      reason: input.reason,
      interactedAt: input.interactedAt,
      knowledgeRoot: input.knowledgeRoot,
    });

    if (input.upsertMemory !== false) {
      if (input.awaitUpsert || input.embedder || input.indexDir) {
        const upsert = await deps.upsertNote(memory.path, {
          type: "interaction",
          knowledgeRoot: input.knowledgeRoot,
          indexDir: input.indexDir,
          embedder: input.embedder,
        });
        if (!upsert.ok && upsert.error) {
          console.warn(
            "confirmed-reply memory upsert soft-fail:",
            upsert.error,
          );
        }
      } else {
        void Promise.resolve(
          deps.scheduleUpsert(memory.path, "interaction"),
        ).catch((err) => {
          console.warn("confirmed-reply memory schedule soft-fail:", err);
        });
      }
    }

    return { state: "saved", memoryPath: memory.path };
  } catch (err) {
    if (err instanceof Error && err.message === FOREIGN_NOTE_ERROR) {
      throw err;
    }
    console.warn("confirmed-reply memory write unavailable:", err);
    return { state: "unavailable" };
  }
}
