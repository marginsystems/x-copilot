/**
 * Scout search stages — client timeline (PR1) and stream labels (PR2).
 */

export type ScoutStageId =
  | "planning"
  | "searching"
  | "filtering"
  | "triaging"
  | "partial"
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
  partial: "Scout found more cool threads…",
  done: "Scout finished.",
  error: "Scout failed.",
};

/** ms between client-side stage advances while search is in flight. */
export const SCOUT_STAGE_TICK_MS = 2800;

export function scoutStageMessage(stage: ScoutStageId): string {
  return SCOUT_STAGE_COPY[stage];
}

/** Gate / busy responses are soft — show the server message, not "Scout failed." */
export function isScoutGateError(
  status: number,
  body: { error?: string; message?: string },
): boolean {
  return (
    status === 429 ||
    status === 402 ||
    body.error === "scout_cooldown" ||
    body.error === "scout_busy" ||
    body.error === "credits_exhausted"
  );
}

/**
 * Concrete status + stage-log line for Scout failures.
 * Soft (cooldown/busy): server message as-is.
 * Hard: always "Scout failed: …" with a real detail string.
 */
export function formatScoutFailure(
  detail: string,
  opts?: { soft?: boolean },
): string {
  const d = detail.trim();
  if (opts?.soft) {
    return d || "Wait before searching again.";
  }
  if (!d) return "Scout failed.";
  if (/^Scout failed:/i.test(d) || /^Sidecar offline/i.test(d)) return d;
  return `Scout failed: ${d}`;
}
