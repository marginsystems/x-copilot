import { getUserById, toPublicUser } from "../auth/authStore.js";
import { ensureUserTenant } from "../billing/billingStore.js";
import { getPlatformDb } from "../db.js";
import { listActiveSuggestions } from "../for-you/forYouStore.js";
import { isRecord } from "../platform/unknownValue.js";
import { readLastScoutPayload } from "../scout/scoutHttp.js";
import type { ApproachGate } from "./approachPhase.js";
import type { ApproachStock } from "./approachSelector.js";
import { buildCoachingSnapshot } from "./coachingSnapshot.js";
import { listMissionsWithProgress } from "./dailyMissions.js";
import { getDeskBeats } from "./deskBeats.js";
import { listActiveInteractions, listInteractionHistory } from "./interactionStore.js";
import { toRetainedInteractions } from "./retainedInteraction.js";

export const AGENDA_MIN_CHARS = 40;
export const ORIGINAL_MISSION_ID = "original_1";
export const APPROACH_RELEASED_TTL_MS = 24 * 60 * 60 * 1000;

export function approachGateFor(user: { xLinked: boolean; agenda: string | null }): ApproachGate | null {
  if (!user.xLinked) return "link_x";
  if ((user.agenda ?? "").trim().length < AGENDA_MIN_CHARS) return "settings";
  return null;
}

export function listReleasedCardIds(userId: string, nowMs: number = Date.now()): string[] {
  const cutoff = new Date(nowMs - APPROACH_RELEASED_TTL_MS).toISOString();
  const rows: unknown[] = getPlatformDb()
    .prepare(
      `SELECT card_id FROM approach_released
        WHERE user_id = ? AND released_at >= ?
        ORDER BY released_at, card_id`,
    )
    .all(userId, cutoff);
  return rows.flatMap((row) => (isRecord(row) && typeof row.card_id === "string" ? [row.card_id] : []));
}

export function releaseCardIds(userId: string, cardIds: readonly string[], nowMs: number = Date.now()): void {
  const db = getPlatformDb();
  db.prepare(`DELETE FROM approach_released WHERE user_id = ? AND released_at < ?`)
    .run(userId, new Date(nowMs - APPROACH_RELEASED_TTL_MS).toISOString());
  const releasedAt = new Date(nowMs).toISOString();
  const insert = db.prepare(
    `INSERT INTO approach_released (user_id, card_id, released_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id, card_id) DO NOTHING`,
  );
  for (const cardId of cardIds) insert.run(userId, cardId, releasedAt);
}

export type ApproachScoutCard = {
  id: string;
  conversationId: string | null;
  inReplyToId: string | null;
  author: string | null;
  url: string | null;
  text: string | null;
};

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function scoutCardsFromTank(threads: readonly unknown[]): ApproachScoutCard[] {
  return threads.flatMap((thread) => {
    if (!isRecord(thread) || typeof thread.id !== "string" || !thread.id) return [];
    return [{
      id: thread.id,
      conversationId: textOrNull(thread.conversationId),
      inReplyToId: textOrNull(thread.inReplyToId),
      author: textOrNull(thread.author),
      url: textOrNull(thread.url),
      text: textOrNull(thread.text),
    }];
  });
}

export type LoadedApproachStock = {
  stock: ApproachStock;
  scoutCards: ApproachScoutCard[];
  suggestions: ReturnType<typeof listActiveSuggestions>;
};

export async function loadApproachStock(userId: string, nowMs: number = Date.now()): Promise<LoadedApproachStock | null> {
  const user = getUserById(userId);
  if (!user) return null;
  const tenantId = ensureUserTenant(userId);
  const [tank, active, history, snapshot] = await Promise.all([
    readLastScoutPayload({ userId, allowAutoStart: false }),
    listActiveInteractions({ userId, nowMs }),
    listInteractionHistory({ userId }),
    buildCoachingSnapshot({ userId, tenantId, nowMs }),
  ]);
  const missions = await listMissionsWithProgress({ userId, snapshot, nowMs });
  const original = missions.find((mission) => mission.id === ORIGINAL_MISSION_ID) ?? null;
  const scoutCards = scoutCardsFromTank(tank.snapshot?.threads ?? []);
  const suggestions = listActiveSuggestions(userId, nowMs);
  return {
    scoutCards,
    suggestions,
    stock: {
      scoutIds: scoutCards.map((card) => card.id),
      suggestions,
      interactedIds: active.map((row) => row.threadId),
      history: toRetainedInteractions(history),
      releasedIds: listReleasedCardIds(userId, nowMs),
      gate: approachGateFor(toPublicUser(user)),
      scoutReplyDone: getDeskBeats({ userId, nowMs }).scoutReplyDone,
      originalMission: original
        ? { progress: original.progress, target: original.target, completed: original.completed }
        : null,
    },
  };
}
