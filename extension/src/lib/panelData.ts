import { coachingPath, parseCoachingPayload } from "../../../shared/src/coaching";
import {
  APPROACH_NEXT_PATH,
  parseApproachNextResponse,
} from "../../../shared/src/approachNext";
import { EXTENSION_SESSION_PATH } from "../../../shared/src/extensionBridge";
import type { ScoutApproachLockCard } from "../../../shared/src/scoutApproachLock";
import { apiRequest } from "./api";
import type { Pairing } from "./pairing";
import { readScoutLock } from "./scoutLock";

export type PanelData = {
  lock: ScoutApproachLockCard | null;
  lockSupported: boolean;
  replyAt: string[];
};

export async function loadPanelData(pairing: Pairing): Promise<PanelData> {
  const [lock, coachingRaw] = await Promise.all([
    readScoutLock(pairing),
    apiRequest(pairing, coachingPath({ lite: true })),
  ]);
  return {
    lock: lock.card,
    lockSupported: lock.supported,
    replyAt: parseCoachingPayload(coachingRaw)?.replyAt ?? [],
  };
}

export async function signOutExtension(pairing: Pairing): Promise<void> {
  await apiRequest(pairing, EXTENSION_SESSION_PATH, { method: "DELETE" });
}

export async function askDeskForNext(pairing: Pairing, fromCardId: string): Promise<boolean> {
  const response = parseApproachNextResponse(
    await apiRequest(pairing, APPROACH_NEXT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromCardId }),
    }),
  );
  if (!response) throw new Error("The desk's Next answer came back malformed.");
  return response.delivered;
}
