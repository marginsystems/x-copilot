import { isRecord } from "./typeGuards.ts";

export const SCOUT_VISIT = "x-copilot:scout-visit";
export const SCOUT_VISIT_ACCEPTED = "x-copilot:scout-visit-accepted";

export type ScoutVisitSide = "left" | "right";
export type ScoutVisit = { type: typeof SCOUT_VISIT; groundFromBottomPx: number | null };
export type ScoutVisitAccepted = { type: typeof SCOUT_VISIT_ACCEPTED; side: ScoutVisitSide };

export const SCOUT_VISIT_MAX_GROUND_PX = 3_000;

function boundedGround(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value >= 0 && value <= SCOUT_VISIT_MAX_GROUND_PX ? value : null;
}

export function parseScoutVisit(raw: unknown): ScoutVisit | null {
  if (!isRecord(raw) || raw.type !== SCOUT_VISIT) return null;
  return { type: SCOUT_VISIT, groundFromBottomPx: boundedGround(raw.groundFromBottomPx) };
}

export function parseScoutVisitAccepted(raw: unknown): ScoutVisitAccepted | null {
  if (!isRecord(raw) || raw.type !== SCOUT_VISIT_ACCEPTED) return null;
  if (raw.side !== "left" && raw.side !== "right") return null;
  return { type: SCOUT_VISIT_ACCEPTED, side: raw.side };
}

export const SCOUT_VISIT_SPEED = 0.4;
export const SCOUT_VISIT_GAP_PX = 40;
export const SCOUT_VISIT_RUN_MS = 1_000;
export const SCOUT_VISIT_GREET_MS = 1_500;
export const SCOUT_VISIT_CROSS_MS = Math.round(SCOUT_VISIT_GAP_PX / SCOUT_VISIT_SPEED);
export const SCOUT_VISIT_OUT_AT_MS = SCOUT_VISIT_RUN_MS;
export const SCOUT_VISIT_IN_AT_MS = SCOUT_VISIT_OUT_AT_MS + SCOUT_VISIT_CROSS_MS;
export const SCOUT_VISIT_GREET_AT_MS = SCOUT_VISIT_IN_AT_MS + SCOUT_VISIT_RUN_MS;
export const SCOUT_VISIT_EXIT_AT_MS = SCOUT_VISIT_GREET_AT_MS + SCOUT_VISIT_GREET_MS;
export const SCOUT_VISIT_PANEL_OUT_AT_MS = SCOUT_VISIT_EXIT_AT_MS + SCOUT_VISIT_RUN_MS;
export const SCOUT_VISIT_BACK_AT_MS = SCOUT_VISIT_PANEL_OUT_AT_MS + SCOUT_VISIT_CROSS_MS;
export const SCOUT_VISIT_TOTAL_MS = SCOUT_VISIT_BACK_AT_MS + SCOUT_VISIT_RUN_MS;

export function scoutVisitEntryEdge(side: ScoutVisitSide): ScoutVisitSide {
  return side === "left" ? "right" : "left";
}

export type ScoutRun = { offset: number; hop: number };

const HOP_EVERY_MS = 450;

export function scoutLeaveRun(sinceMs: number, distance: number, windowMs = SCOUT_VISIT_RUN_MS): ScoutRun {
  const reach = Math.max(0, distance);
  if (sinceMs >= windowMs) return { offset: reach + SCOUT_VISIT_SPEED * (sinceMs - windowMs), hop: 0 };
  const length = Math.min(windowMs, (3 * reach) / SCOUT_VISIT_SPEED);
  const t = sinceMs - (windowMs - length);
  if (t <= 0 || length <= 0) return { offset: 0, hop: 0 };
  const cubic = (SCOUT_VISIT_SPEED * length - 2 * reach) / length ** 3;
  const square = (3 * reach - SCOUT_VISIT_SPEED * length) / length ** 2;
  const hops = Math.max(1, Math.round(length / HOP_EVERY_MS));
  return {
    offset: Math.min(reach, Math.max(0, cubic * t ** 3 + square * t ** 2)),
    hop: Math.abs(Math.sin((Math.PI * hops * t) / length)),
  };
}

export function scoutArriveRun(sinceMs: number, distance: number, sizePx: number): ScoutRun {
  const reach = Math.max(0, distance);
  const cruise = Math.min(Math.max(0, sizePx), reach);
  const cruiseMs = cruise / SCOUT_VISIT_SPEED;
  if (sinceMs <= cruiseMs) return { offset: SCOUT_VISIT_SPEED * sinceMs, hop: 0 };
  if (sinceMs >= SCOUT_VISIT_RUN_MS) return { offset: reach, hop: 0 };
  const leave = scoutLeaveRun(SCOUT_VISIT_RUN_MS - sinceMs, reach - cruise, SCOUT_VISIT_RUN_MS - cruiseMs);
  return { offset: reach - leave.offset, hop: leave.hop };
}

export type ScoutVisitorStep = {
  name: "waiting" | "enter" | "greet" | "exit" | "gone";
  progress: number;
};

function within(elapsedMs: number, startMs: number, lengthMs: number): number {
  return Math.min(1, Math.max(0, (elapsedMs - startMs) / lengthMs));
}

export function scoutVisitorStep(elapsedMs: number): ScoutVisitorStep {
  if (elapsedMs < SCOUT_VISIT_IN_AT_MS) return { name: "waiting", progress: 0 };
  if (elapsedMs < SCOUT_VISIT_GREET_AT_MS) {
    return { name: "enter", progress: within(elapsedMs, SCOUT_VISIT_IN_AT_MS, SCOUT_VISIT_RUN_MS) };
  }
  if (elapsedMs < SCOUT_VISIT_EXIT_AT_MS) {
    return { name: "greet", progress: within(elapsedMs, SCOUT_VISIT_GREET_AT_MS, SCOUT_VISIT_GREET_MS) };
  }
  if (elapsedMs < SCOUT_VISIT_TOTAL_MS) {
    return { name: "exit", progress: within(elapsedMs, SCOUT_VISIT_EXIT_AT_MS, SCOUT_VISIT_BACK_AT_MS - SCOUT_VISIT_EXIT_AT_MS) };
  }
  return { name: "gone", progress: 1 };
}

export function scoutHostWeight(elapsedMs: number): number {
  if (elapsedMs < SCOUT_VISIT_IN_AT_MS) return within(elapsedMs, 0, SCOUT_VISIT_IN_AT_MS);
  if (elapsedMs < SCOUT_VISIT_PANEL_OUT_AT_MS) return 1;
  return 1 - within(elapsedMs, SCOUT_VISIT_PANEL_OUT_AT_MS, SCOUT_VISIT_RUN_MS);
}

export type ScoutSpeaker = "guest" | "resident" | null;

export function scoutSpeaker(step: ScoutVisitorStep): ScoutSpeaker {
  if (step.name !== "greet") return null;
  return step.progress < 0.5 ? "guest" : "resident";
}

export const SCOUT_STAGE_SHIFT_MAX_PX = 48;

export function scoutStageShift(opts: {
  deskGroundPx: number | null;
  ownGroundPx: number;
  roomUpPx: number;
  roomDownPx: number;
}): number {
  const { deskGroundPx, ownGroundPx, roomUpPx, roomDownPx } = opts;
  if (deskGroundPx === null || boundedGround(deskGroundPx) === null) return 0;
  if (boundedGround(ownGroundPx) === null) return 0;
  if (!Number.isFinite(roomUpPx) || !Number.isFinite(roomDownPx)) return 0;
  const shift = Math.round(ownGroundPx - deskGroundPx);
  if (Math.abs(shift) > SCOUT_STAGE_SHIFT_MAX_PX) return 0;
  if (shift > 0) return Math.min(shift, Math.max(0, Math.floor(roomDownPx)));
  const up = Math.min(-shift, Math.max(0, Math.floor(roomUpPx)));
  return up === 0 ? 0 : -up;
}
