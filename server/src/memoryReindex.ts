/**
 * Lazy / manual memory-index rebuild with a single in-flight guard.
 */
import {
  memoryIndexStatus,
  reindexMemory,
  upsertMemoryNote,
  type MemoryType,
  type ReindexResult,
} from "./memoryIndex.js";

/** Dedupe concurrent reindexes so only one full rebuild runs at a time. */
let memoryReindexInFlight: Promise<ReindexResult> | null = null;

/** Best-effort index upsert — never fails the request. */
export function scheduleMemoryUpsert(notePath: string, type: MemoryType): void {
  void (async () => {
    if (memoryReindexInFlight) {
      await memoryReindexInFlight;
    }
    const result = await upsertMemoryNote(notePath, { type });
    if (!result.ok && result.error) {
      console.warn(`memory upsert soft-fail (${type}):`, result.error);
    }
  })();
}

/** Rebuild index, sharing the in-flight guard across lazy and manual paths. */
export function runMemoryReindex(): Promise<ReindexResult> {
  if (!memoryReindexInFlight) {
    memoryReindexInFlight = reindexMemory().finally(() => {
      memoryReindexInFlight = null;
    });
  }
  return memoryReindexInFlight;
}

/** Rebuild index when it has never been fully built (lazy boot). Soft-fails. */
export async function ensureMemoryIndex(): Promise<void> {
  const status = await memoryIndexStatus();
  if (status.dbIndexed) return;
  const result = await runMemoryReindex();
  if (!result.ok && result.error) {
    console.warn("memory reindex soft-fail:", result.error);
  }
}

export function parseMemoryTypes(raw: unknown): MemoryType[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const types = raw.filter(
    (t): t is MemoryType => t === "interaction" || t === "dismissal",
  );
  return types.length ? [...new Set(types)] : undefined;
}
