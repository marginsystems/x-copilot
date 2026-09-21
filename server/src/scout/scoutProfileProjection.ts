/**
 * Projection hook between durable Scout evidence (C09) and the ScoutProfile
 * store (C10).
 *
 * `scoutEvidence.ts` calls `notifyScoutEvidenceChanged` after a material
 * change. The store registers its rebuild function when it loads, so this
 * module never imports the store and evidence SQL stays independent of the
 * profile module (no import cycle). Until a rebuild function is registered,
 * notifications are dropped; `readScoutProfile` repairs stale projections on
 * read either way.
 *
 * Rebuilds run on `setImmediate`, i.e. after the synchronous better-sqlite3
 * transaction that produced the change has committed or rolled back. A
 * rebuild reads committed evidence only, so a rolled-back change simply
 * yields the unchanged profile. Notifications for one user are coalesced:
 * one rebuild in flight, at most one queued behind it.
 */

export type ScoutEvidenceChange = {
  userId: string;
  revision: number;
};

export type ScoutProfileRebuildFn = (userId: string) => Promise<unknown>;

type PendingState = {
  running: boolean;
  dirty: boolean;
  done: Promise<void>;
};

let rebuildFn: ScoutProfileRebuildFn | null = null;
const pending = new Map<string, PendingState>();
let notified = 0;
let failures = 0;

/** Installed once by scoutProfileStore.ts; `null` disables projections. */
export function setScoutProfileRebuild(fn: ScoutProfileRebuildFn | null): void {
  rebuildFn = fn;
}

export function hasScoutProfileRebuild(): boolean {
  return rebuildFn !== null;
}

function runProjection(userId: string, state: PendingState): Promise<void> {
  return new Promise<void>((resolveDone) => {
    setImmediate(async () => {
      state.running = true;
      try {
        do {
          state.dirty = false;
          const fn = rebuildFn;
          if (!fn) break;
          try {
            await fn(userId);
          } catch (err) {
            failures += 1;
            console.warn(
              `[scout-profile] projection rebuild failed userId=${userId}:`,
              err instanceof Error ? err.message : err,
            );
          }
        } while (state.dirty);
      } finally {
        state.running = false;
        pending.delete(userId);
        resolveDone();
      }
    });
  });
}

/**
 * Schedule the per-user projection after a material evidence change. Safe to
 * call from inside a SQL transaction: nothing runs until the current
 * synchronous work (including that transaction) has finished.
 */
export function notifyScoutEvidenceChanged(change: ScoutEvidenceChange): void {
  const userId = typeof change.userId === "string" ? change.userId.trim() : "";
  if (!userId || !rebuildFn) return;
  notified += 1;
  const existing = pending.get(userId);
  if (existing) {
    existing.dirty = true;
    return;
  }
  const state: PendingState = {
    running: false,
    dirty: false,
    done: Promise.resolve(),
  };
  pending.set(userId, state);
  state.done = runProjection(userId, state);
}

/** Wait for every scheduled or running projection (tests, shutdown). */
export async function flushScoutProfileProjections(): Promise<void> {
  // Rebuilds may schedule follow-ups; drain until the map is empty.
  for (let i = 0; i < 100 && pending.size > 0; i++) {
    await Promise.all([...pending.values()].map((state) => state.done));
  }
}

export function scoutProfileProjectionStats(): {
  notified: number;
  failures: number;
  pending: number;
} {
  return { notified, failures, pending: pending.size };
}

export function resetScoutProfileProjectionForTests(): void {
  rebuildFn = null;
  pending.clear();
  notified = 0;
  failures = 0;
}
