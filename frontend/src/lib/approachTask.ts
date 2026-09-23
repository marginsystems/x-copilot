/**
 * One Approach task: the locked card plus the For You wait that belongs to it.
 * Every entry into a For You card opens a fresh wait; every exit drops it. A
 * restore recovers the stored wait only when it belongs to the same owner and
 * the restored lock is still a For You task.
 */
import {
  advanceApproach,
  initialApproachLock,
  isForYouTask,
  normalizeApproachLock,
  type ApproachEvent,
  type ApproachGate,
  type ApproachInventory,
  type ApproachLock,
} from "./deskPhase";
import {
  openForYouWait,
  type ActivityCursor,
  type ForYouWait,
} from "./forYouTask";

export type ApproachTaskState = {
  lock: ApproachLock;
  wait: ForYouWait | null;
};

export type ApproachTaskContext = {
  owner: string;
  cursor?: ActivityCursor | null;
  now?: number;
};

export type ApproachNormalizeContext = {
  gate: ApproachGate | null;
  scoutId: string | null;
  suggestionId?: string | null;
  canOpenForYou: boolean;
};

function waitFor(
  lock: ApproachLock,
  ctx: ApproachTaskContext,
): ForYouWait | null {
  return isForYouTask(lock) ? openForYouWait(ctx) : null;
}

/** Boot: normalize the stored lock, then recover or freshly baseline its wait. */
export function restoreApproachTask(opts: {
  stored: ApproachLock | null;
  storedWait: ForYouWait | null;
  normalize: ApproachNormalizeContext;
  paceLocked: boolean;
  task: ApproachTaskContext;
}): ApproachTaskState {
  const storedWait =
    opts.storedWait && opts.storedWait.owner === opts.task.owner
      ? opts.storedWait
      : null;
  const lock = opts.stored
    ? normalizeApproachLock(opts.stored, opts.normalize)
    : initialApproachLock({
        forYouHeld: storedWait !== null,
        paceLocked: opts.paceLocked,
        scoutId: opts.normalize.gate ? null : opts.normalize.scoutId,
        fallback: opts.normalize.gate ?? "for_you",
      });
  if (!isForYouTask(lock)) return { lock, wait: null };
  return { lock, wait: storedWait ?? openForYouWait(opts.task) };
}

/**
 * A card event. No effect synthesizes a transition on its own; the dismiss
 * effect replays one after the write completes. Returns the same state when
 * the event does not change the locked card (for example Next with empty Scout stock).
 */
export function transitionApproachTask(
  state: ApproachTaskState,
  event: ApproachEvent,
  inventory: ApproachInventory,
  ctx: ApproachTaskContext,
): ApproachTaskState {
  const lock = advanceApproach(state.lock, event, inventory);
  if (lock === state.lock) return state;
  return {
    lock,
    wait: isForYouTask(state.lock) && lock.phase === "hold"
      ? state.wait
      : waitFor(lock, ctx),
  };
}

/** A prerequisite changed. Active tasks keep their identity and wait. */
export function reconcileApproachGate(
  state: ApproachTaskState,
  normalize: ApproachNormalizeContext,
  ctx: ApproachTaskContext,
): ApproachTaskState {
  const lock = normalizeApproachLock(state.lock, normalize);
  if (lock === state.lock) return state;
  return { lock, wait: waitFor(lock, ctx) };
}
