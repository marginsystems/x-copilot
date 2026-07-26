/**
 * Scout search stages — client timeline (PR1) and stream labels (PR2).
 */

export type ScoutStageId =
  | "planning"
  | "searching"
  | "filtering"
  | "triaging"
  | "done"
  | "error";

export const SCOUT_AGENT = "scout";

/** Stages advanced on a timer while waiting on POST /api/search. */
export const SCOUT_SEARCH_TIMELINE: ScoutStageId[] = [
  "planning",
  "searching",
  "filtering",
  "triaging",
];

export const SCOUT_STAGE_COPY: Record<ScoutStageId, string> = {
  planning: "Scout is planning search queries…",
  searching: "Scout is searching X…",
  filtering: "Scout is applying cooldown + length filters…",
  triaging: "Scout is scoring threads for bait risk…",
  done: "Scout finished.",
  error: "Scout failed.",
};

/** ms between client-side stage advances while search is in flight. */
export const SCOUT_STAGE_TICK_MS = 2800;

export function scoutStageMessage(stage: ScoutStageId): string {
  return SCOUT_STAGE_COPY[stage];
}
