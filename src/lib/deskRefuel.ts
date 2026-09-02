import type { DeskPhase } from "./deskPhase";

/** Fire Scout while Approach is empty or on the one-minute hold. */
export function shouldBackgroundScout(opts: {
  phase: DeskPhase;
  searching: boolean;
  grounded: boolean;
  cooldownRemainingSec: number;
  needsXLink: boolean;
  hasAgenda: boolean;
  alreadyTried: boolean;
}): boolean {
  return (
    (opts.phase === "silent_refuel" || opts.phase === "hold") &&
    !opts.searching &&
    !opts.grounded &&
    opts.cooldownRemainingSec <= 0 &&
    !opts.needsXLink &&
    opts.hasAgenda &&
    !opts.alreadyTried
  );
}
