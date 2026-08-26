/**
 * Deterministic UTC-day missions. Progress is read from the coaching
 * snapshot; XP is awarded once when a mission first hits its target.
 */
import { getPlatformDb } from "./db.js";
import { applyMissionXp, withGamificationState } from "./gamification.js";
import type { CoachingSnapshot } from "./coachingSnapshot.js";

export type MissionMetric = "marks" | "originals" | "takeoffs";

export type MissionDef = {
  id: string;
  label: string;
  target: number;
  xpReward: number;
  metric: MissionMetric;
};

export const DAILY_MISSION_DEFS: readonly MissionDef[] = [
  {
    id: "mark_2",
    label: "Mark 2 replies",
    target: 2,
    xpReward: 4,
    metric: "marks",
  },
  {
    id: "original_1",
    label: "Post 1 original",
    target: 1,
    xpReward: 3,
    metric: "originals",
  },
  {
    id: "takeoff_1",
    label: "Take off once",
    target: 1,
    xpReward: 2,
    metric: "takeoffs",
  },
];

export type DailyMissionPublic = {
  id: string;
  label: string;
  target: number;
  progress: number;
  xpReward: number;
  completed: boolean;
  claimed: boolean;
};

export function progressForMetric(
  snapshot: CoachingSnapshot,
  metric: MissionMetric,
): number {
  if (metric === "marks") return snapshot.marksToday;
  if (metric === "originals") return snapshot.originalsToday;
  return snapshot.takeoffsToday;
}

export function ensureDailyMissions(opts: {
  userId: string;
  dayUtc: string;
}): void {
  const insert = getPlatformDb().prepare(
    `INSERT INTO daily_missions
       (user_id, day_utc, mission_id, target, xp_reward, claimed_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON CONFLICT(user_id, day_utc, mission_id) DO NOTHING`,
  );
  for (const def of DAILY_MISSION_DEFS) {
    insert.run(opts.userId, opts.dayUtc, def.id, def.target, def.xpReward);
  }
}

function claimedAt(
  userId: string,
  dayUtc: string,
  missionId: string,
): string | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT claimed_at AS claimedAt FROM daily_missions
        WHERE user_id = ? AND day_utc = ? AND mission_id = ?`,
    )
    .get(userId, dayUtc, missionId) as { claimedAt: string | null } | undefined;
  return row?.claimedAt ?? null;
}

function tryClaim(opts: {
  userId: string;
  dayUtc: string;
  missionId: string;
  atIso: string;
}): boolean {
  const info = getPlatformDb()
    .prepare(
      `UPDATE daily_missions
          SET claimed_at = ?
        WHERE user_id = ? AND day_utc = ? AND mission_id = ?
          AND claimed_at IS NULL`,
    )
    .run(opts.atIso, opts.userId, opts.dayUtc, opts.missionId);
  return info.changes > 0;
}

export async function listMissionsWithProgress(opts: {
  userId: string;
  snapshot: CoachingSnapshot;
  nowMs?: number;
  gamificationPath?: string;
}): Promise<DailyMissionPublic[]> {
  const nowMs = opts.nowMs ?? Date.now();
  const dayUtc = opts.snapshot.dayUtc;
  ensureDailyMissions({ userId: opts.userId, dayUtc });
  const out: DailyMissionPublic[] = [];
  for (const def of DAILY_MISSION_DEFS) {
    const progress = progressForMetric(opts.snapshot, def.metric);
    const completed = progress >= def.target;
    let claimed = Boolean(claimedAt(opts.userId, dayUtc, def.id));
    if (completed && !claimed) {
      if (
        tryClaim({
          userId: opts.userId,
          dayUtc,
          missionId: def.id,
          atIso: new Date(nowMs).toISOString(),
        })
      ) {
        await withGamificationState({
          userId: opts.userId,
          nowMs,
          gamificationPath: opts.gamificationPath,
          fn: (state) => ({
            state: applyMissionXp(state, def.xpReward, nowMs),
            result: null,
          }),
        });
        claimed = true;
      } else {
        claimed = Boolean(claimedAt(opts.userId, dayUtc, def.id));
      }
    }
    out.push({
      id: def.id,
      label: def.label,
      target: def.target,
      progress: Math.min(progress, def.target),
      xpReward: def.xpReward,
      completed,
      claimed,
    });
  }
  return out;
}
