import { isRecord } from "./typeGuards.ts";

export const SCOUT_VISIT = "x-copilot:scout-visit";
export const SCOUT_VISIT_ACCEPTED = "x-copilot:scout-visit-accepted";

export type ScoutVisitSide = "left" | "right";
export type ScoutVisit = { type: typeof SCOUT_VISIT };
export type ScoutVisitAccepted = { type: typeof SCOUT_VISIT_ACCEPTED; side: ScoutVisitSide };

export function parseScoutVisit(raw: unknown): ScoutVisit | null {
  return isRecord(raw) && raw.type === SCOUT_VISIT ? { type: SCOUT_VISIT } : null;
}

export function parseScoutVisitAccepted(raw: unknown): ScoutVisitAccepted | null {
  if (!isRecord(raw) || raw.type !== SCOUT_VISIT_ACCEPTED) return null;
  if (raw.side !== "left" && raw.side !== "right") return null;
  return { type: SCOUT_VISIT_ACCEPTED, side: raw.side };
}

export const SCOUT_VISIT_LEAVE_MS = 900;
export const SCOUT_VISIT_ENTER_MS = 900;
export const SCOUT_VISIT_GREET_MS = 1_800;
export const SCOUT_VISIT_EXIT_MS = 900;
export const SCOUT_VISIT_STAY_MS = SCOUT_VISIT_ENTER_MS + SCOUT_VISIT_GREET_MS + SCOUT_VISIT_EXIT_MS;
export const SCOUT_VISIT_RETURN_MS = 900;
export const SCOUT_VISIT_TOTAL_MS = SCOUT_VISIT_LEAVE_MS + SCOUT_VISIT_STAY_MS + SCOUT_VISIT_RETURN_MS;

export function scoutVisitEntryEdge(side: ScoutVisitSide): ScoutVisitSide {
  return side === "left" ? "right" : "left";
}

export type ScoutVisitPhase = { name: "leave" | "stay" | "return" | "done"; progress: number };

function within(elapsedMs: number, startMs: number, lengthMs: number): number {
  return Math.min(1, Math.max(0, (elapsedMs - startMs) / lengthMs));
}

export function scoutVisitPhase(elapsedMs: number): ScoutVisitPhase {
  const stayEnd = SCOUT_VISIT_LEAVE_MS + SCOUT_VISIT_STAY_MS;
  if (elapsedMs < SCOUT_VISIT_LEAVE_MS) {
    return { name: "leave", progress: within(elapsedMs, 0, SCOUT_VISIT_LEAVE_MS) };
  }
  if (elapsedMs < stayEnd) {
    return { name: "stay", progress: within(elapsedMs, SCOUT_VISIT_LEAVE_MS, SCOUT_VISIT_STAY_MS) };
  }
  if (elapsedMs < SCOUT_VISIT_TOTAL_MS) {
    return { name: "return", progress: within(elapsedMs, stayEnd, SCOUT_VISIT_RETURN_MS) };
  }
  return { name: "done", progress: 1 };
}

export type ScoutVisitorStep = {
  name: "waiting" | "enter" | "greet" | "exit" | "gone";
  progress: number;
};

export function scoutVisitorStep(elapsedMs: number): ScoutVisitorStep {
  const enterEnd = SCOUT_VISIT_LEAVE_MS + SCOUT_VISIT_ENTER_MS;
  const greetEnd = enterEnd + SCOUT_VISIT_GREET_MS;
  const exitEnd = greetEnd + SCOUT_VISIT_EXIT_MS;
  if (elapsedMs < SCOUT_VISIT_LEAVE_MS) return { name: "waiting", progress: 0 };
  if (elapsedMs < enterEnd) {
    return { name: "enter", progress: within(elapsedMs, SCOUT_VISIT_LEAVE_MS, SCOUT_VISIT_ENTER_MS) };
  }
  if (elapsedMs < greetEnd) {
    return { name: "greet", progress: within(elapsedMs, enterEnd, SCOUT_VISIT_GREET_MS) };
  }
  if (elapsedMs < exitEnd) {
    return { name: "exit", progress: within(elapsedMs, greetEnd, SCOUT_VISIT_EXIT_MS) };
  }
  return { name: "gone", progress: 1 };
}

export function scoutHostWeight(elapsedMs: number): number {
  const phase = scoutVisitPhase(elapsedMs);
  if (phase.name === "leave") return phase.progress;
  if (phase.name === "stay") return 1;
  if (phase.name === "return") return 1 - phase.progress;
  return 0;
}

export type ScoutSpeaker = "guest" | "resident" | null;

export function scoutSpeaker(step: ScoutVisitorStep): ScoutSpeaker {
  if (step.name !== "greet") return null;
  return step.progress < 0.5 ? "guest" : "resident";
}
