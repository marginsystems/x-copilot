import { getPlatformDb } from "../db.js";
import { isRecord } from "../platform/unknownValue.js";

export const DESK_PHASES = [
  "needs_onboarding",
  "hold",
  "scout_reply",
  "organic_reply",
  "silent_refuel",
  "done_for_now",
] as const;

export const APPROACH_SURFACES = ["for_you", "link_x", "settings", "usage", "wait"] as const;

export const APPROACH_TASK_OWNERS = ["desk", "server"] as const;

export const APPROACH_TASK_CARD_ID_MAX = 128;

export type ApproachTaskLock = {
  phase: (typeof DESK_PHASES)[number];
  cardId: string | null;
  surface: (typeof APPROACH_SURFACES)[number] | null;
};

export type ApproachTaskOwner = (typeof APPROACH_TASK_OWNERS)[number];

export type ApproachTask = {
  lock: ApproachTaskLock;
  version: number;
  owner: ApproachTaskOwner;
  updatedAt: string;
};

export function approachTaskLockFromBody(value: unknown): ApproachTaskLock | null {
  if (!isRecord(value)) return null;
  const phase = DESK_PHASES.find((candidate) => candidate === value.phase);
  if (!phase) return null;
  const { cardId } = value;
  if (cardId !== null && (typeof cardId !== "string" || !cardId || cardId.length > APPROACH_TASK_CARD_ID_MAX)) {
    return null;
  }
  if (value.surface === null) return { phase, cardId, surface: null };
  const surface = APPROACH_SURFACES.find((candidate) => candidate === value.surface);
  return surface ? { phase, cardId, surface } : null;
}

function sameLock(a: ApproachTaskLock, b: ApproachTaskLock): boolean {
  return a.phase === b.phase && a.cardId === b.cardId && a.surface === b.surface;
}

export function getApproachTask(userId: string): ApproachTask | null {
  const row: unknown = getPlatformDb()
    .prepare(
      `SELECT phase, card_id, surface, version, owner, updated_at
       FROM approach_tasks WHERE user_id = ?`,
    )
    .get(userId);
  if (!isRecord(row)) return null;
  const lock = approachTaskLockFromBody({ phase: row.phase, cardId: row.card_id, surface: row.surface });
  const owner = APPROACH_TASK_OWNERS.find((candidate) => candidate === row.owner);
  if (!lock || !owner || typeof row.version !== "number" || typeof row.updated_at !== "string") return null;
  return { lock, version: row.version, owner, updatedAt: row.updated_at };
}

export function setApproachTask(
  userId: string,
  lock: ApproachTaskLock,
  owner: ApproachTaskOwner,
  nowMs: number = Date.now(),
): ApproachTask {
  const current = getApproachTask(userId);
  if (current && current.owner === owner && sameLock(current.lock, lock)) return current;
  const version = (current?.version ?? 0) + 1;
  const updatedAt = new Date(nowMs).toISOString();
  getPlatformDb()
    .prepare(
      `INSERT INTO approach_tasks (user_id, phase, card_id, surface, version, owner, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         phase = excluded.phase,
         card_id = excluded.card_id,
         surface = excluded.surface,
         version = excluded.version,
         owner = excluded.owner,
         updated_at = excluded.updated_at`,
    )
    .run(userId, lock.phase, lock.cardId, lock.surface, version, owner, updatedAt);
  return { lock, version, owner, updatedAt };
}
