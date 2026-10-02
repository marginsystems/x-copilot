import type { ApproachLock } from "./deskPhase.ts";
import { isRecord } from "./typeGuards.ts";

export const APPROACH_NEXT_PATH = "/api/desk/approach/next";
export const APPROACH_NEXT_EVENT = "approach_next";
export const APPROACH_NEXT_ID_MAX = 64;

export type ApproachNextRequest = { fromCardId: string };

export function parseApproachNextRequest(raw: unknown): ApproachNextRequest | null {
  if (!isRecord(raw) || typeof raw.fromCardId !== "string") return null;
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
  fromCardId: string,
  scoutDetected: boolean,
): boolean {
  return lock.phase === "scout_reply" && lock.cardId === fromCardId && scoutDetected;
}
