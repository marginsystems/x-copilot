/** Expand / collapse timing for Approach rows. Keep in sync with 12-threads.css. */
export const DESK_ROW_EXPAND_MS = 380;

export type DeskRowExpandPhase = "closed" | "entering" | "open" | "leaving";

/** First step after `open` flips. Entering mounts at 0fr; leaving keeps the slot for exit. */
export function deskRowPhaseOnOpenChange(
  phase: DeskRowExpandPhase,
  open: boolean,
): DeskRowExpandPhase {
  if (open) return phase === "open" ? "open" : "entering";
  return phase === "closed" ? "closed" : "leaving";
}

export function deskRowPhaseAfterEnter(
  phase: DeskRowExpandPhase,
): DeskRowExpandPhase {
  return phase === "entering" ? "open" : phase;
}

export function deskRowPhaseAfterLeave(
  phase: DeskRowExpandPhase,
): DeskRowExpandPhase {
  return phase === "leaving" ? "closed" : phase;
}

export function deskRowExpandMount(phase: DeskRowExpandPhase): boolean {
  return phase !== "closed";
}

export function deskRowExpandOpen(phase: DeskRowExpandPhase): boolean {
  return phase === "open";
}

export function deskRowInitialPhase(open: boolean): DeskRowExpandPhase {
  return open ? "open" : "closed";
}

/** Approach starts open. Minus stores this row id so collapse sticks until + or a new card. */
export function approachRowOpen(
  closedId: string | null,
  rowId: string,
): boolean {
  return closedId !== rowId;
}

export function nextApproachClosedId(
  closedId: string | null,
  rowId: string,
): string | null {
  return closedId === rowId ? null : rowId;
}
