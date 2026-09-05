import type { CoachingState, NextActionKind } from "./coaching";
import type { DeskPhase } from "./deskPhase";
import type { ForYouKind, ForYouSuggestion } from "./forYou";
import { scoutStageMessage } from "./scoutStages";

export const APPROACH_COLLECTING_IDLE =
  "Scout is looking for the next reply.";

export function approachCollectingCopy(opts: { searching?: boolean }): string {
  return opts.searching
    ? scoutStageMessage("searching")
    : APPROACH_COLLECTING_IDLE;
}

export function coachingMatchesCard(
  phase: DeskPhase,
  kind: NextActionKind,
  suggestionKind?: ForYouKind | null,
): boolean {
  if (kind === "takeoff") return false;
  if (phase === "scout_reply") return kind === "reply" || kind === "streak";
  if (phase === "hold" || phase === "silent_refuel") return kind === "for_you";
  if (phase === "organic_reply") {
    if (suggestionKind === "post") return kind === "original";
    if (suggestionKind === "quote") return kind === "quote";
    if (suggestionKind === "repost") return kind === "repost";
    return kind === "reply" || kind === "for_you";
  }
  if (phase === "original") return kind === "original";
  if (phase === "fork") return kind === "original" || kind === "reply";
  return false;
}

export function phaseWhy(
  phase: DeskPhase,
  coaching?: CoachingState | null,
  suggestion?: ForYouSuggestion | null,
): string {
  if (phase === "done_for_now") {
    return APPROACH_COLLECTING_IDLE;
  }
  if (phase === "organic_reply" && suggestion?.kind === "post") {
    return "Compose an original. Mark it here.";
  }
  if (phase === "organic_reply" && suggestion?.kind === "quote") {
    return "Quote something you actually read. Mark it here.";
  }
  if (phase === "organic_reply" && suggestion?.kind === "repost") {
    return "Repost something you actually read. Mark it here.";
  }
  const action = coaching?.nextAction;
  const line = action?.text?.trim();
  if (
    line &&
    action &&
    coachingMatchesCard(phase, action.kind, suggestion?.kind)
  ) {
    return line;
  }
  if (phase === "scout_reply") {
    return "Reply to this thread. Then mark it.";
  }
  if (phase === "organic_reply") {
    return "Open X. Reply to something you actually read. Mark it here.";
  }
  if (phase === "fork") {
    return "Write an original, or one more reply.";
  }
  if (phase === "original") {
    return "Compose one original.";
  }
  return "";
}
