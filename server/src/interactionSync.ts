import { getPlatformDb } from "./db.js";
import { ensureUserTenant } from "./billingStore.js";
import { DEFAULT_STATS_TICK_CAP } from "./interactionStats.js";
import {
  listAllInteractionRows,
  readInteractionRow,
  requireUserId,
  writeInteractionRow,
  type Interaction,
} from "./interactionStore.js";

export type GamificationCheckpoint = "mark" | "t24h";

/** Interactions whose stats → memory projection failed and should be retried. */
export async function listMemorySyncRetries(opts?: {
  limit?: number;
}): Promise<Interaction[]> {
  return listAllInteractionRows({
    where: "memory_sync_failed = 1",
    limit: Math.max(0, opts?.limit ?? DEFAULT_STATS_TICK_CAP),
  });
}

/** Record whether a stats → memory projection failed, so the next tick retries. */
export async function setMemorySyncFailed(opts: {
  threadId: string;
  userId: string;
  failed: boolean;
}): Promise<void> {
  const threadId = opts.threadId.trim();
  if (!threadId) return;
  const userId = requireUserId(opts.userId);
  const db = getPlatformDb();
  db.transaction(() => {
    const row = readInteractionRow(userId, threadId);
    if (!row) return;
    if (!!row.memorySyncFailed === opts.failed) return;
    const next: Interaction = { ...row };
    if (opts.failed) next.memorySyncFailed = true;
    else delete next.memorySyncFailed;
    writeInteractionRow(next, ensureUserTenant(userId));
  })();
}

/** Interactions whose gamification ledger projection failed and should be retried. */
export async function listGamificationSyncRetries(opts?: {
  limit?: number;
}): Promise<Interaction[]> {
  return listAllInteractionRows({
    where:
      "(mark_gamification_sync_failed = 1 OR bonus_gamification_sync_failed = 1)",
    limit: Math.max(0, opts?.limit ?? DEFAULT_STATS_TICK_CAP),
  });
}

/** Record whether a gamification ledger projection failed, so the next tick retries. */
export async function setGamificationSyncFailed(opts: {
  threadId: string;
  userId: string;
  checkpoint: GamificationCheckpoint;
  failed: boolean;
  /** Original mark `at` to replay when a mark projection soft-fails; appended
   * to the pending list so a re-mark of the same thread (which overwrites `at`)
   * cannot erase an earlier uncredited mark instance. */
  pendingAt?: string;
  /** Mark `at`s a retry tick successfully replayed. When clearing the mark
   * flag, only these are dropped from the pending list; ats appended by a
   * concurrent soft-fail since the retry snapshot are kept for the next tick. */
  clearedPendingAts?: string[];
}): Promise<void> {
  const threadId = opts.threadId.trim();
  if (!threadId) return;
  const userId = requireUserId(opts.userId);
  const db = getPlatformDb();
  db.transaction(() => {
    const row = readInteractionRow(userId, threadId);
    if (!row) return;
    const field: "markGamificationSyncFailed" | "bonusGamificationSyncFailed" =
      opts.checkpoint === "mark"
        ? "markGamificationSyncFailed"
        : "bonusGamificationSyncFailed";
    let pendingAtNew = false;
    if (opts.checkpoint === "mark" && opts.failed && opts.pendingAt) {
      pendingAtNew = !row.pendingMarkAts?.includes(opts.pendingAt);
    }
    if (!!row[field] === opts.failed && !pendingAtNew) return;
    const next: Interaction = { ...row };
    if (opts.failed) {
      next[field] = true;
      if (opts.checkpoint === "mark" && opts.pendingAt) {
        const pendingMarkAts = row.pendingMarkAts ?? [];
        next.pendingMarkAts = pendingMarkAts.includes(opts.pendingAt)
          ? pendingMarkAts
          : [...pendingMarkAts, opts.pendingAt];
      }
    } else if (
      opts.checkpoint === "mark" &&
      opts.clearedPendingAts &&
      opts.clearedPendingAts.length
    ) {
      // Only drop the ats this retry actually replayed; keep the flag set so
      // an at appended by a concurrent soft-fail is retried on the next tick.
      const remaining = (row.pendingMarkAts ?? []).filter(
        (at) => !opts.clearedPendingAts!.includes(at),
      );
      if (remaining.length) {
        next.pendingMarkAts = remaining;
      } else {
        delete next[field];
        delete next.pendingMarkAts;
      }
    } else {
      delete next[field];
      if (opts.checkpoint === "mark") {
        delete next.pendingMarkAts;
      }
    }
    writeInteractionRow(next, ensureUserTenant(userId));
  })();
}
