import { ensureUserTenant } from "./billingStore.js";
import { getPlatformDb } from "./db.js";
import {
  listAllInteractionRows,
  MAX_INTERACTION_STORE,
  readInteractionRow,
  requireUserId,
  writeInteractionRow,
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
  userId: string;
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
        userId: row.userId,
        checkpoint: "t1h",
        postedAt: row.postedAt!,
      });
    }
    if (!row.stats?.t24h && age >= STATS_T24H_MS) {
      due.push({
        threadId: row.threadId,
        replyId,
        userId: row.userId,
        checkpoint: "t24h",
        postedAt: row.postedAt!,
      });
    }
  }
  // Prefer older posts first so late 24h samples don't starve behind fresh 1h.
  due.sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));
  return due.slice(0, Math.max(0, limit));
}

/** Worker sweep across every desk: rows with a reply id, all users. */
export async function listDueStatSamples(opts?: {
  nowMs?: number;
  limit?: number;
}): Promise<DueStatSample[]> {
  const rows = listAllInteractionRows({
    where: "reply_id IS NOT NULL",
    limit: MAX_INTERACTION_STORE,
  });
  return selectDueStatSamples(
    rows,
    opts?.nowMs ?? Date.now(),
    opts?.limit ?? DEFAULT_STATS_TICK_CAP,
  );
}

/** Merge a stats snapshot onto an interaction by user and threadId. */
export async function patchInteractionStats(opts: {
  threadId: string;
  userId: string;
  checkpoint: StatsCheckpoint;
  snapshot: ReplyStatSnapshot;
}): Promise<Interaction | null> {
  const threadId = opts.threadId.trim();
  if (!threadId) return null;
  const userId = requireUserId(opts.userId);
  const db = getPlatformDb();
  return db.transaction((): Interaction | null => {
    const row = readInteractionRow(userId, threadId);
    if (!row) return null;
    const stats: InteractionStats = { ...(row.stats ?? {}) };
    stats[opts.checkpoint] = opts.snapshot;
    const next: Interaction = { ...row, stats };
    writeInteractionRow(next, ensureUserTenant(userId));
    return next;
  })();
}
