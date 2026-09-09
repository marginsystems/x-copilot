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
