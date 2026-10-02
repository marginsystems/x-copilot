import {
  parseScoutApproachLockResponse,
  SCOUT_APPROACH_LOCK_PATH,
  type ScoutApproachLockCard,
} from "../../../shared/src/scoutApproachLock";
import { ApiStatusError, apiRequest } from "./api";
import type { Pairing } from "./pairing";

export const OLDER_SERVER_NOTICE =
  "The X Copilot server is a version behind this extension, so Scout cards can't show here yet. Showing For You.";

export type ScoutLockRead = { card: ScoutApproachLockCard | null; supported: boolean };

export function serverLacksLockRead(err: unknown): boolean {
  return err instanceof ApiStatusError && (err.status === 404 || err.status === 405);
}

export async function readScoutLock(pairing: Pairing): Promise<ScoutLockRead> {
  let raw: unknown;
  try {
    raw = await apiRequest(pairing, SCOUT_APPROACH_LOCK_PATH);
  } catch (err) {
    if (serverLacksLockRead(err)) return { card: null, supported: false };
    throw err;
  }
  const parsed = parseScoutApproachLockResponse(raw);
  if (!parsed) return { card: null, supported: true };
  return { card: parsed.card, supported: true };
}
