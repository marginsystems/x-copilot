import type { DeskPhase } from "./deskPhase";

/** Fire Scout while Approach is empty. Cooldown is the credit gate. */
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
    opts.phase === "silent_refuel" &&
    !opts.searching &&
    !opts.grounded &&
    opts.cooldownRemainingSec <= 0 &&
    !opts.needsXLink &&
    opts.hasAgenda &&
    !opts.alreadyTried
  );
}
