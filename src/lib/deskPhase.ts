export const DESK_PHASES = [
  "needs_onboarding",
  "hold",
  "scout_reply",
  "organic_reply",
  "fork",
  "original",
  "silent_refuel",
  "done_for_now",
] as const;

export type DeskPhase = (typeof DESK_PHASES)[number];

export type DeskBeats = {
  scoutReplyDone: boolean;
  organicReplyDone: boolean;
  /** null = no fork pick yet */
  forkChoice: "original" | "reply" | null;
  forkDone: boolean;
};

export type DeskPhaseInput = {
  needsOnboarding: boolean;
  paceLocked: boolean;
  /** Reserved. PR 2 UI passes false so Bypass stays the pace clock. */
  overheat: boolean;
  hasScoutCard: boolean;
  /** Suggested OG / quote / reply. Served when Scout is empty. */
  hasSuggestion: boolean;
  searching: boolean;
  beats: DeskBeats;
};

export type DeskPhaseResult = {
  phase: DeskPhase;
  hold: boolean;
};

export function emptyDeskBeats(): DeskBeats {
  return {
    scoutReplyDone: false,
    organicReplyDone: false,
    forkChoice: null,
    forkDone: false,
  };
}

/**
 * One-card wrap over the existing tank.
 * Beats do not hide Scout or Suggested. Done does not empty Approach.
 */
export function deskPhase(input: DeskPhaseInput): DeskPhaseResult {
  let phase: DeskPhase;

  if (input.needsOnboarding) {
    phase = "needs_onboarding";
  } else if (input.paceLocked || input.overheat) {
    phase = "hold";
  } else if (input.hasScoutCard) {
    phase = "scout_reply";
  } else if (input.hasSuggestion) {
    phase = "organic_reply";
  } else {
    phase = "silent_refuel";
  }

  return {
    phase,
    hold: phase === "hold",
  };
}

/** Approach tab badge: the card on the desk (0 or 1). */
export function approachTabLiveCount(opts: {
  phase: DeskPhase;
  hasScoutCard: boolean;
  hasSuggestion: boolean;
}): number {
  if (opts.phase === "scout_reply" && opts.hasScoutCard) return 1;
  if (opts.phase === "organic_reply" && opts.hasSuggestion) {
    return 1;
  }
  if (opts.phase === "original" && opts.hasSuggestion) return 1;
  return 0;
}
