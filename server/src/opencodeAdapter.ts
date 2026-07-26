/**
 * Thin OpenCode-compatible turn log for Scout stages.
 * Not a full OpenCode CLI integration — structured agent activity only.
 */

export type ScoutStageEvent = {
  agent: "scout";
  stage: string;
  message: string;
  detail?: unknown;
  at: string;
};

export type OpenCodeTurn = {
  id: string;
  role: "assistant" | "tool";
  status: "running" | "completed" | "failed";
  title: string;
  detail?: string;
  at: string;
};

/** Map Scout stage events into mini-agent turn records for the UI log. */
export function toOpenCodeTurns(events: ScoutStageEvent[]): OpenCodeTurn[] {
  return events.map((ev, i) => {
    const failed = ev.stage === "error";
    const done = ev.stage === "done";
    return {
      id: `scout-${i + 1}-${ev.stage}`,
      role: ev.stage === "searching" || ev.stage === "triaging" ? "tool" : "assistant",
      status: failed ? "failed" : done ? "completed" : "completed",
      title: ev.message,
      detail:
        ev.detail === undefined
          ? undefined
          : typeof ev.detail === "string"
            ? ev.detail
            : JSON.stringify(ev.detail),
      at: ev.at,
    };
  });
}
