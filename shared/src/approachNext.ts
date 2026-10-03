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

export type ApproachNextRequest = { fromCardId: string } | { forYou: true };

export function parseApproachNextRequest(raw: unknown): ApproachNextRequest | null {
  if (!isRecord(raw)) return null;
  if (raw.forYou === true && raw.fromCardId === undefined) return { forYou: true };
  if (typeof raw.fromCardId !== "string" || raw.forYou !== undefined) return null;
  const fromCardId = raw.fromCardId.trim();
  if (!fromCardId || fromCardId.length > APPROACH_NEXT_ID_MAX) return null;
  return { fromCardId };
}

export function parseApproachNextResponse(raw: unknown): { delivered: boolean } | null {
  if (!isRecord(raw) || raw.ok !== true || typeof raw.delivered !== "boolean") return null;
  return { delivered: raw.delivered };
}

export function remoteNextApplies(
  lock: ApproachLock,
  request: ApproachNextRequest,
  scoutDetected: boolean,
): boolean {
  if ("forYou" in request) return isForYouTask(lock);
  return lock.phase === "scout_reply" && lock.cardId === request.fromCardId && scoutDetected;
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
