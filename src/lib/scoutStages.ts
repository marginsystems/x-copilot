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
  planning: "Plotting the route…",
  searching: "In the air…",
  filtering: "Clearing the noise…",
  triaging: "Picking the approach…",
  partial: "Found more threads…",
  done: "Landed.",
  error: "Couldn't land.",
};

/** ms between client-side stage advances while search is in flight. */
export const SCOUT_STAGE_TICK_MS = 2800;

/** Later stages win; ticker must not rewind past a real stream stage. */
export const SCOUT_STAGE_RANK: Record<ScoutStageId, number> = {
  planning: 0,
  searching: 1,
  filtering: 2,
  partial: 2,
  triaging: 3,
  done: 4,
  error: 4,
};

export function scoutStageMessage(stage: ScoutStageId): string {
  return SCOUT_STAGE_COPY[stage];
}

/** One-line desk status: flight copy plus optional cool/candidate counts. */
export function scoutFlightLine(
  stage: ScoutStageId,
  opts?: {
    cool?: number;
    target?: number;
    candidates?: number;
    bucketSize?: number;
  },
): string {
  const base = scoutStageMessage(stage);
  if (stage === "done" || stage === "error") return base;
  if (typeof opts?.cool === "number" && opts.cool > 0) {
    return typeof opts.target === "number"
      ? `${base} ${opts.cool}/${opts.target}`
      : `${base} ${opts.cool}`;
  }
  if (
    typeof opts?.candidates === "number" &&
    typeof opts.bucketSize === "number"
  ) {
    return `${base} ${opts.candidates}/${opts.bucketSize}`;
  }
  return base;
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
    body.error === "scout_daily_limit" ||
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
  if (
    /\b(sidecar|pm2|npm|localhost)\b/i.test(d) ||
    /(?:^|\s)\.?\/[\w.-]+/.test(d)
  ) {
    return "Scout is unavailable right now.";
  }
  if (opts?.soft) {
    return d || "Wait before searching again.";
  }
  if (!d) return "Scout failed.";
  if (/^Scout failed:/i.test(d)) return d;
  return `Scout failed: ${d}`;
}
