import type { ForYouKind } from "./forYou";

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
  /** Any Approach suggestion counts as inventory (prefer reply in the UI). */
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

export function deskPhase(input: DeskPhaseInput): DeskPhaseResult {
  let phase: DeskPhase;

  if (input.needsOnboarding) {
    phase = "needs_onboarding";
  } else if (input.paceLocked || input.overheat) {
    phase = "hold";
  } else if (input.beats.forkDone) {
    phase = "done_for_now";
  } else if (
    input.beats.organicReplyDone &&
    input.beats.forkChoice === null
  ) {
    phase = "fork";
  } else if (input.beats.forkChoice === "original") {
    phase = "original";
  } else if (input.beats.forkChoice === "reply") {
    phase = input.hasScoutCard
      ? "scout_reply"
      : input.hasSuggestion
        ? "organic_reply"
        : "silent_refuel";
  } else if (
    input.beats.scoutReplyDone &&
    !input.beats.organicReplyDone
  ) {
    phase = "organic_reply";
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

/** Approach tab badge: cards on the desk, not parked inventory. */
export function approachTabLiveCount(opts: {
  phase: DeskPhase;
  hasScoutCard: boolean;
  hasSuggestion: boolean;
  suggestionKind?: ForYouKind;
}): number {
  if (opts.phase === "scout_reply" && opts.hasScoutCard) return 1;
  if (opts.phase === "organic_reply" && opts.hasSuggestion) {
    return 1;
  }
  if (opts.phase === "original" && opts.suggestionKind === "post") {
    return 1;
  }
  return 0;
}
