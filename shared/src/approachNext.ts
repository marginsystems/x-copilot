import {
  advanceApproach,
  isForYouTask,
  type ApproachInventory,
  type ApproachLock,
} from "./deskPhase.ts";
import { isRecord } from "./typeGuards.ts";

export const APPROACH_NEXT_PATH = "/api/desk/approach/next";
export const APPROACH_NEXT_EVENT = "approach_next";
export const APPROACH_NEXT_ID_MAX = 64;
export const APPROACH_NEXT_ACTIONS = ["next", "skip", "dismiss"] as const;

export type ApproachNextAction = (typeof APPROACH_NEXT_ACTIONS)[number];
export type ApproachCardAction = Exclude<ApproachNextAction, "next">;
export type ApproachCardKind = "scout" | "suggestion";

export type ApproachNextRequest =
  | { fromCardId: string }
  | { fromCardId: string; action: ApproachCardAction; kind: ApproachCardKind }
  | { forYou: true };

export function parseApproachNextRequest(raw: unknown): ApproachNextRequest | null {
  if (!isRecord(raw)) return null;
  const action = raw.action === undefined
    ? "next"
    : APPROACH_NEXT_ACTIONS.find((candidate) => candidate === raw.action);
  if (!action) return null;
  if (raw.forYou === true && raw.fromCardId === undefined) {
    return action === "next" ? { forYou: true } : null;
  }
  if (typeof raw.fromCardId !== "string" || raw.forYou !== undefined) return null;
  const fromCardId = raw.fromCardId.trim();
  if (!fromCardId || fromCardId.length > APPROACH_NEXT_ID_MAX) return null;
  if (action === "next") return { fromCardId };
  if (raw.kind !== "scout" && raw.kind !== "suggestion") return null;
  return { fromCardId, action, kind: raw.kind };
}

export function approachNextEvent(request: ApproachNextRequest): { type: ApproachNextAction } {
  return { type: "action" in request && request.action ? request.action : "next" };
}

export type ApproachActionNotice = {
  action: ApproachCardAction;
  fromCardId: string;
  kind: "scout" | "suggestion";
};

export function parseApproachActionNotice(raw: unknown): ApproachActionNotice | null {
  if (!isRecord(raw) || (raw.action !== "skip" && raw.action !== "dismiss")) return null;
  if (typeof raw.fromCardId !== "string" || !raw.fromCardId) return null;
  if (raw.kind !== "scout" && raw.kind !== "suggestion") return null;
  return { action: raw.action, fromCardId: raw.fromCardId, kind: raw.kind };
}

export function parseApproachNextResponse(raw: unknown): { delivered: boolean; advanced: boolean } | null {
  if (!isRecord(raw) || raw.ok !== true || typeof raw.delivered !== "boolean") return null;
  return { delivered: raw.delivered, advanced: raw.advanced === true };
}

export function remoteNextApplies(lock: ApproachLock, request: ApproachNextRequest): boolean {
  if ("forYou" in request) return isForYouTask(lock);
  if (lock.cardId !== request.fromCardId) return false;
  if ("action" in request && request.action) return lock.phase === "scout_reply" || lock.phase === "organic_reply";
  return lock.phase === "scout_reply";
}

export function remoteNextStale(lock: ApproachLock, request: ApproachNextRequest): boolean {
  if ("forYou" in request) return !isForYouTask(lock);
  return lock.cardId !== request.fromCardId;
}

export function upNextLock(lock: ApproachLock, inventory: ApproachInventory): ApproachLock | null {
  const remoteNextCanApply = isForYouTask(lock) || (lock.phase === "scout_reply" && lock.cardId !== null);
  if (!remoteNextCanApply) return null;
  const next = advanceApproach(lock, { type: "next" }, inventory);
  return next === lock ? null : next;
}
