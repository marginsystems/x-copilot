import { coachingPath, parseCoachingPayload } from "../../../shared/src/coaching";
import { EXTENSION_SESSION_PATH } from "../../../shared/src/extensionBridge";
import {
  parseScoutApproachLockResponse,
  SCOUT_APPROACH_LOCK_PATH,
  type ScoutApproachLockCard,
} from "../../../shared/src/scoutApproachLock";
import { apiRequest } from "./api";
import type { Pairing } from "./pairing";

export type PanelData = { lock: ScoutApproachLockCard | null; replyAt: string[] };

export async function loadPanelData(pairing: Pairing): Promise<PanelData> {
  const [lockRaw, coachingRaw] = await Promise.all([
    apiRequest(pairing, SCOUT_APPROACH_LOCK_PATH),
    apiRequest(pairing, coachingPath({ lite: true })),
  ]);
  const lock = parseScoutApproachLockResponse(lockRaw);
  if (!lock) throw new Error("The approach lock came back malformed.");
  return { lock: lock.card, replyAt: parseCoachingPayload(coachingRaw)?.replyAt ?? [] };
}

export async function signOutExtension(pairing: Pairing): Promise<void> {
  await apiRequest(pairing, EXTENSION_SESSION_PATH, { method: "DELETE" });
}
