/** Scout stream stages and status labels. */

export type ScoutStageId =
  | "planning"
  | "searching"
  | "filtering"
  | "triaging"
  | "partial"
  | "done"
  | "error";

export const SCOUT_AGENT = "scout";

export const SCOUT_STAGE_COPY: Record<ScoutStageId, string> = {
  planning: "Plotting the route…",
  searching: "In the air…",
  filtering: "Clearing the noise…",
  triaging: "Picking the approach…",
  partial: "Found more threads…",
  done: "Landed.",
  error: "Couldn't land.",
};

export const SCOUT_STAGE_VERB: Record<ScoutStageId, string> = {
  planning: "Planning",
  searching: "Searching",
  filtering: "Filtering",
  triaging: "Triaging",
  partial: "Collecting",
  done: "Collecting",
  error: "Collecting",
};

export function scoutStageMessage(stage: ScoutStageId): string {
  return SCOUT_STAGE_COPY[stage];
}

export function scoutStageVerb(stage: ScoutStageId): string {
  return SCOUT_STAGE_VERB[stage];
}

export function isScoutStageId(value: string | undefined): value is ScoutStageId {
  return !!value && Object.hasOwn(SCOUT_STAGE_COPY, value);
}

export function scoutStageInFlight(stage?: ScoutStageId | null): boolean {
  return (
    stage === "planning" ||
    stage === "searching" ||
    stage === "filtering" ||
    stage === "triaging" ||
    stage === "partial"
  );
}

/** Branded stage line. Counts stay on the same sentence so FadeSwap can tick them. */
export function brandedScoutLine(opts: {
  stage: ScoutStageId;
  candidates?: number;
  bucketSize?: number;
  coolCount?: number;
  targetCool?: number;
}): string {
  const base = SCOUT_STAGE_COPY[opts.stage];
  if (
    opts.stage === "searching" &&
    opts.candidates != null &&
    opts.bucketSize
  ) {
    return `${base} ${opts.candidates}/${opts.bucketSize}`;
  }
  if (
    (opts.stage === "partial" || opts.stage === "triaging") &&
    opts.coolCount != null &&
    opts.targetCool
  ) {
    return `${base} ${opts.coolCount}/${opts.targetCool}`;
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
