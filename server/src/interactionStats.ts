import { withFileLock } from "./fileLock.js";
import {
  defaultStorePath,
  readStore,
  writeStore,
  type Interaction,
  type InteractionStats,
  type ReplyStatSnapshot,
} from "./interactionStore.js";

export const STATS_T1H_MS = 60 * 60 * 1000;
export const STATS_T24H_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_STATS_TICK_CAP = 15;

export type StatsCheckpoint = "t1h" | "t24h";

export type DueStatSample = {
  threadId: string;
  replyId: string;
  checkpoint: StatsCheckpoint;
  postedAt: string;
};

function postedAtMs(row: Interaction): number | null {
  if (!row.postedAt) return null;
  const t = Date.parse(row.postedAt);
  return Number.isFinite(t) ? t : null;
}

/**
 * Interactions due for a 1h or 24h reply-stats snapshot (oldest due first).
 * Skips rows without replyId. One checkpoint entry per due slot.
 */
export function selectDueStatSamples(
  interactions: Interaction[],
  nowMs: number = Date.now(),
  limit: number = DEFAULT_STATS_TICK_CAP,
): DueStatSample[] {
  const due: DueStatSample[] = [];
  for (const row of interactions) {
    const replyId = row.replyId?.trim();
    if (!replyId) continue;
    const posted = postedAtMs(row);
    if (posted === null) continue;
    const age = nowMs - posted;
    if (age < 0) continue;
    if (!row.stats?.t1h && age >= STATS_T1H_MS) {
      due.push({
        threadId: row.threadId,
        replyId,
        checkpoint: "t1h",
        postedAt: row.postedAt!,
      });
    }
    if (!row.stats?.t24h && age >= STATS_T24H_MS) {
      due.push({
        threadId: row.threadId,
        replyId,
        checkpoint: "t24h",
        postedAt: row.postedAt!,
      });
    }
  }
  // Prefer older posts first so late 24h samples don't starve behind fresh 1h.
  due.sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));
  return due.slice(0, Math.max(0, limit));
}

export async function listDueStatSamples(opts?: {
  nowMs?: number;
  storePath?: string;
  limit?: number;
}): Promise<DueStatSample[]> {
  const path = opts?.storePath ?? defaultStorePath();
  const store = await readStore(path);
  return selectDueStatSamples(
    store.interactions,
    opts?.nowMs ?? Date.now(),
    opts?.limit ?? DEFAULT_STATS_TICK_CAP,
  );
}

/** Merge a stats snapshot onto an interaction by threadId. */
export async function patchInteractionStats(opts: {
  threadId: string;
  checkpoint: StatsCheckpoint;
  snapshot: ReplyStatSnapshot;
  storePath?: string;
}): Promise<Interaction | null> {
  const threadId = opts.threadId.trim();
  if (!threadId) return null;
  const path = opts.storePath ?? defaultStorePath();

  return withFileLock(path, async () => {
    const store = await readStore(path);
    const idx = store.interactions.findIndex((i) => i.threadId === threadId);
    if (idx < 0) return null;
    const row = store.interactions[idx];
    const stats: InteractionStats = { ...(row.stats ?? {}) };
    stats[opts.checkpoint] = opts.snapshot;
    const next: Interaction = { ...row, stats };
    const interactions = [...store.interactions];
    interactions[idx] = next;
    await writeStore(path, { interactions });
    return next;
  });
}
