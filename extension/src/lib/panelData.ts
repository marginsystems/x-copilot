import { coachingPath, parseCoachingPayload } from "../../../shared/src/coaching";
import {
  APPROACH_NEXT_PATH,
  parseApproachNextResponse,
  type ApproachCardAction,
  type ApproachNextRequest,
} from "../../../shared/src/approachNext";
import { EXTENSION_SESSION_PATH } from "../../../shared/src/extensionBridge";
import type { DeskApproachState, ScoutApproachLockCard, ScoutApproachNext } from "../../../shared/src/scoutApproachLock";
import { apiRequest, UnpairedError } from "./api";
import type { Pairing } from "./pairing";
import type { PanelCardTarget } from "./panelModel";
import { parseScoutStats, type ScoutStats } from "../../../shared/src/scoutCompanion";
import { readScoutLock } from "./scoutLock";

export type PanelData = {
  lock: ScoutApproachLockCard | null;
  lockSupported: boolean;
  nextUp: ScoutApproachNext | null;
  deskState: DeskApproachState | null;
  suggestionId: string | null;
  replyAt: string[];
  repliesToday: number | null;
  scout: ScoutStats | null;
};

const GAMIFICATION_PATH = "/api/gamification";
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
    nextUp: lock.next,
    deskState: lock.state,
    suggestionId: lock.suggestionId,
    replyAt: parseCoachingPayload(coachingRaw)?.replyAt ?? [],
    repliesToday: parseCoachingPayload(coachingRaw)?.repliesToday ?? null,
    scout,
  };
}

export async function signOutExtension(pairing: Pairing): Promise<void> {
  await apiRequest(pairing, EXTENSION_SESSION_PATH, { method: "DELETE" });
}

export type NextTaker = "desk" | "server";

export async function askDeskForNext(pairing: Pairing, request: ApproachNextRequest): Promise<NextTaker | null> {
  const response = parseApproachNextResponse(
    await apiRequest(pairing, APPROACH_NEXT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }),
  );
  if (!response) throw new Error("The desk's Next answer came back malformed.");
  if (response.advanced) return "server";
  return response.delivered ? "desk" : null;
}

export const SKIPPED_PATH = "/api/skipped";
export const DISMISSED_PATH = "/api/dismissed";

function presentFields(card: ScoutApproachLockCard): Record<string, string> {
  const fields: Record<string, string | null> = {
    threadId: card.id,
    author: card.author,
    url: card.url,
    text: card.text,
    conversationId: card.conversationId,
    inReplyToId: card.inReplyToId,
  };
  return Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export async function recordCardAction(
  pairing: Pairing,
  target: PanelCardTarget,
  action: ApproachCardAction,
  reason = "",
  postedTweetId: string | null = null,
): Promise<void> {
  const post = (path: string, body: Record<string, string>) =>
    apiRequest(pairing, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  if (target.kind === "suggestion") {
    const body: Record<string, string> = { id: target.suggestionId };
    if (action === "posted" && postedTweetId) body.postedTweetId = postedTweetId;
    await post(`/api/for-you/${action === "posted" ? "done" : action}`, body);
    return;
  }
  if (action === "skip") {
    await post(SKIPPED_PATH, presentFields(target.card));
    return;
  }
  const why = reason.trim();
  await post(DISMISSED_PATH, { ...presentFields(target.card), ...(why ? { reason: why } : {}) });
}
