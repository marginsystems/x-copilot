/**
 * Lazy / manual memory-index rebuild with a single in-flight guard.
 *
 * The in-process promise dedupes rebuilds inside one server; ordering across
 * processes (server vs. webhook sidecar) is handled by memoryIndex itself,
 * which publishes a rebuild in one locked transaction and never lets an
 * older read overwrite a newer row.
 */
import {
  memoryIndexStatus,
  reindexMemory,
  upsertMemoryNote,
  type Embedder,
  type MemoryType,
  type ReindexResult,
} from "./memoryIndex.js";

export type MemoryReindexOpts = {
  knowledgeRoot?: string;
  indexDir?: string;
  embedder?: Embedder;
};

/** Dedupe concurrent reindexes so only one full rebuild runs at a time. */
let memoryReindexInFlight: Promise<ReindexResult> | null = null;

/** Best-effort index upsert — never fails the request. */
export async function scheduleMemoryUpsert(
  notePath: string,
  type: MemoryType,
  opts?: MemoryReindexOpts,
): Promise<void> {
  try {
    if (memoryReindexInFlight) {
      await memoryReindexInFlight;
    }
    const result = await upsertMemoryNote(notePath, { ...opts, type });
    if (!result.ok && result.error) {
      console.warn(`memory upsert soft-fail (${type}):`, result.error);
    }
  } catch (err) {
    console.warn(
      `memory upsert soft-fail (${type}):`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Rebuild index, sharing the in-flight guard across lazy and manual paths. */
export function runMemoryReindex(opts?: MemoryReindexOpts): Promise<ReindexResult> {
  if (!memoryReindexInFlight) {
    memoryReindexInFlight = reindexMemory(opts).finally(() => {
      memoryReindexInFlight = null;
    });
  }
  return memoryReindexInFlight;
}

/**
 * Rebuild index when no complete rebuild has been published under the
 * current schema (lazy boot, or an index left over from the pre-owner
 * layout). Soft-fails.
 */
export async function ensureMemoryIndex(opts?: MemoryReindexOpts): Promise<void> {
  const status = await memoryIndexStatus(opts);
  if (status.dbIndexed) return;
  const result = await runMemoryReindex(opts);
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
