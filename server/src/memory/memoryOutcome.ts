/**
 * Soft-fail orchestration: project interaction stats onto Markdown + MiniLM upsert.
 */
import type { Interaction } from "../desk/interactionStore.js";
import type { StatsCheckpoint } from "../desk/interactionStats.js";
import { updateInteractionMemoryOutcome } from "./knowledgeMemory.js";
import { upsertMemoryNote, type Embedder } from "./memoryIndex.js";

export type SyncInteractionOutcomeResult =
  | { ok: true; path: string; upserted: boolean }
  | { ok: false; error: string; path?: string };

export async function syncInteractionOutcomeMemory(opts: {
  interaction: Interaction;
  checkpoint?: StatsCheckpoint;
  knowledgeRoot?: string;
  indexDir?: string;
  embedder?: Embedder;
  nowIso?: string;
}): Promise<SyncInteractionOutcomeResult> {
  // The owner is part of note identity: an unowned interaction cannot be
  // matched to a note, so it soft-fails before any filesystem work.
  if (!opts.interaction.userId?.trim()) {
    return { ok: false, error: "interaction has no owner" };
  }
  const updated = await updateInteractionMemoryOutcome({
    interaction: opts.interaction,
    checkpoint: opts.checkpoint,
    knowledgeRoot: opts.knowledgeRoot,
    nowIso: opts.nowIso,
  });
  if (!updated.ok) {
    return { ok: false, error: updated.error, path: updated.path };
  }

  const upsert = await upsertMemoryNote(updated.path, {
    type: "interaction",
    knowledgeRoot: opts.knowledgeRoot,
    indexDir: opts.indexDir,
    embedder: opts.embedder,
  });
  if (!upsert.ok) {
    return {
      ok: false,
      path: updated.path,
      error: upsert.error ?? "memory upsert failed",
    };
  }
  return { ok: true, path: updated.path, upserted: true };
}
