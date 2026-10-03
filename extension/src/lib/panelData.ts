import { coachingPath, parseCoachingPayload } from "../../../shared/src/coaching";
import {
  APPROACH_NEXT_PATH,
  parseApproachNextResponse,
  type ApproachNextRequest,
} from "../../../shared/src/approachNext";
import { EXTENSION_SESSION_PATH } from "../../../shared/src/extensionBridge";
import type { ScoutApproachLockCard } from "../../../shared/src/scoutApproachLock";
import { apiRequest, UnpairedError } from "./api";
import type { Pairing } from "./pairing";
import { GAMIFICATION_PATH, parseScoutStats, type ScoutStats } from "./scout";
import { readScoutLock } from "./scoutLock";

export type PanelData = {
  lock: ScoutApproachLockCard | null;
  lockSupported: boolean;
  replyAt: string[];
  scout: ScoutStats | null;
};

export const SCOUT_STATS_FRESH_MS = 60_000;

let scoutStatsCache: { token: string; atMs: number; stats: ScoutStats } | null = null;

export async function readScoutStats(pairing: Pairing, nowMs: number = Date.now()): Promise<ScoutStats | null> {
  const cached = scoutStatsCache;
  if (cached && cached.token === pairing.token && nowMs - cached.atMs < SCOUT_STATS_FRESH_MS) return cached.stats;
  let stats: ScoutStats | null = null;
  try {
    stats = parseScoutStats(await apiRequest(pairing, GAMIFICATION_PATH));
  } catch (err) {
    if (err instanceof UnpairedError) throw err;
  }
  if (!stats) return cached?.token === pairing.token ? cached.stats : null;
  scoutStatsCache = { token: pairing.token, atMs: nowMs, stats };
  return stats;
}

export async function loadPanelData(pairing: Pairing): Promise<PanelData> {
  const [lock, coachingRaw, scout] = await Promise.all([
    readScoutLock(pairing),
    apiRequest(pairing, coachingPath({ lite: true })),
    readScoutStats(pairing),
  ]);
  return {
    lock: lock.card,
    lockSupported: lock.supported,
    replyAt: parseCoachingPayload(coachingRaw)?.replyAt ?? [],
    scout,
  };
}

export async function signOutExtension(pairing: Pairing): Promise<void> {
  await apiRequest(pairing, EXTENSION_SESSION_PATH, { method: "DELETE" });
}

export async function askDeskForNext(pairing: Pairing, request: ApproachNextRequest): Promise<boolean> {
  const response = parseApproachNextResponse(
    await apiRequest(pairing, APPROACH_NEXT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }),
  );
  if (!response) throw new Error("The desk's Next answer came back malformed.");
  return response.delivered;
}
