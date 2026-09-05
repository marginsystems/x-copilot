import type { DeskPhase } from "./deskPhase";

/** Start a background takeoff when the last scouted card is on the desk or gone. */
export const SCOUT_TANK_LOW = 1;
export const SCOUT_TAKEOFF_TRIED_STORAGE_KEY =
  "x-copilot-scout-takeoff-tried";

export function readScoutTakeoffTried(): boolean {
  try {
    return sessionStorage.getItem(SCOUT_TAKEOFF_TRIED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markScoutTakeoffTried(): void {
  try {
    sessionStorage.setItem(SCOUT_TAKEOFF_TRIED_STORAGE_KEY, "1");
  } catch {
    /* private mode */
  }
}

export function clearScoutTakeoffTried(): void {
  try {
    sessionStorage.removeItem(SCOUT_TAKEOFF_TRIED_STORAGE_KEY);
  } catch {
    /* private mode */
  }
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
