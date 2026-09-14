import type { DeskPhase } from "./deskPhase";

/** Start a background takeoff when the last scouted card is on the desk or gone. */
export const SCOUT_TANK_LOW = 1;

export function shouldArmScoutRefill(usableScoutCount: number): boolean {
  return usableScoutCount <= SCOUT_TANK_LOW;
}

/**
 * Tank stock the selector may lock and the refill trigger may count. A card
 * with a recorded reply, or one this desk already released, is retained for
 * presentation only; it is not stock.
 */
export function eligibleScoutCards<T extends { id: string }>(
  threads: readonly T[],
  ...consumed: ReadonlySet<string>[]
): T[] {
  return threads.filter((row) => !consumed.some((set) => set.has(row.id)));
}

export function shouldArmScoutOnBoot(opts: {
  usableScoutCount: number;
  searching: boolean;
  tankKnown: boolean;
  handledThisOpen: boolean;
}): boolean {
  // A previous page's attempt does not spend this opening's low-tank refill.
  return (
    opts.tankKnown &&
    !opts.handledThisOpen &&
    shouldArmScoutRefill(opts.usableScoutCount) &&
    !opts.searching
  );
}

function phaseAllowsBackgroundScout(phase: DeskPhase): boolean {
  return (
    phase === "silent_refuel" ||
    phase === "hold" ||
    phase === "scout_reply" ||
    phase === "organic_reply" ||
    phase === "done_for_now"
  );
}

/** Fire Scout when the tank is low. Daily takeoff / credit gates stay outside. */
export function shouldBackgroundScout(opts: {
  phase: DeskPhase;
  searching: boolean;
  grounded: boolean;
  cooldownRemainingSec: number;
  needsXLink: boolean;
  hasAgenda: boolean;
  scoutCount: number;
  alreadyTried: boolean;
}): boolean {
  return (
    phaseAllowsBackgroundScout(opts.phase) &&
    !opts.searching &&
    !opts.grounded &&
    opts.cooldownRemainingSec <= 0 &&
    !opts.needsXLink &&
    opts.hasAgenda &&
    opts.scoutCount <= SCOUT_TANK_LOW &&
    !opts.alreadyTried
  );
}

/** After scout_busy, wait, re-arm one takeoff, or drop the in-air card. */
export function nextBlockedScoutAction(opts: {
  searching: boolean;
  scoutBlocked: boolean;
  cooldownRemainingSec: number;
  deskReady: boolean;
  agendaReady: boolean;
  needsXLink: boolean;
  hasAgenda: boolean;
  grounded: boolean;
  usableScoutCount: number;
  alreadyArmed: boolean;
}): "wait" | "arm" | "release" {
  if (opts.searching || !opts.scoutBlocked) return "wait";
  if (opts.cooldownRemainingSec > 0) return "wait";
  if (!opts.deskReady || !opts.agendaReady) return "wait";
  if (
    opts.needsXLink ||
    !opts.hasAgenda ||
    opts.grounded ||
    !shouldArmScoutRefill(opts.usableScoutCount)
  ) {
    return "release";
  }
  if (opts.alreadyArmed) return "wait";
  return "arm";
}
