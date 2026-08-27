/**
 * Last-seen /play cursor. Diffes coaching + gamification against a
 * per-user store so celebrate fires once per real event.
 * Kept free of DOM so tests inject a plain map.
 */

import type { CoachingState } from "./coaching";
import type { AchievementPublic, GamificationStats } from "./gamification";
import { toastFromMarkProgress } from "./gamification";

export const PLAY_SEEN_KEY_PREFIX = "x-copilot-play-seen:";

export type PlaySeenStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type PlaySeenCursor = {
  dayUtc: string;
  claimedMissionIds: string[];
  unlockedAchievementIds: string[];
  level: number;
  lastMarkUtcDay: string | null;
};

export type PlayDeltaKind = "level" | "achievement" | "mission" | "mark";

export type PlayDelta = {
  kind: PlayDeltaKind;
  line: string;
};

export function playSeenKey(userId: string): string {
  return `${PLAY_SEEN_KEY_PREFIX}${userId}`;
}

export function memoryPlaySeenStorage(
  seed: Record<string, string> = {},
): PlaySeenStorage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

export function browserPlaySeenStorage(): PlaySeenStorage {
  return {
    getItem(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* private mode */
      }
    },
  };
}

function stringList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item) return null;
    out.push(item);
  }
  return out;
}

export function parsePlaySeenCursor(raw: unknown): PlaySeenCursor | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.dayUtc !== "string") return null;
  if (typeof row.level !== "number" || !Number.isFinite(row.level)) return null;
  const claimedMissionIds = stringList(row.claimedMissionIds);
  const unlockedAchievementIds = stringList(row.unlockedAchievementIds);
  if (!claimedMissionIds || !unlockedAchievementIds) return null;
  let lastMarkUtcDay: string | null;
  if (row.lastMarkUtcDay === null) lastMarkUtcDay = null;
  else if (typeof row.lastMarkUtcDay === "string") lastMarkUtcDay = row.lastMarkUtcDay;
  else return null;
  return {
    dayUtc: row.dayUtc,
    claimedMissionIds,
    unlockedAchievementIds,
    level: Math.floor(row.level),
    lastMarkUtcDay,
  };
}

export function cursorFromState(
  coaching: CoachingState,
  gamification: GamificationStats,
): PlaySeenCursor {
  return {
    dayUtc: coaching.dayUtc,
    claimedMissionIds: coaching.missions.filter((m) => m.claimed).map((m) => m.id),
    unlockedAchievementIds: gamification.achievements
      .filter((row) => row.unlocked)
      .map((row) => row.id),
    level: gamification.level,
    lastMarkUtcDay: gamification.lastMarkUtcDay,
  };
}

export function readPlaySeen(
  store: PlaySeenStorage,
  userId: string,
): PlaySeenCursor | null {
  const raw = store.getItem(playSeenKey(userId));
  if (!raw) return null;
  try {
    return parsePlaySeenCursor(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writePlaySeen(
  store: PlaySeenStorage,
  userId: string,
  cursor: PlaySeenCursor,
): void {
  store.setItem(playSeenKey(userId), JSON.stringify(cursor));
}

function newestIds(prev: string[], next: string[]): string[] {
  const seen = new Set(prev);
  return next.filter((id) => !seen.has(id));
}

function achievementTitle(
  id: string,
  achievements: AchievementPublic[],
): string {
  return achievements.find((row) => row.id === id)?.title ?? id;
}

function missionLine(coaching: CoachingState, id: string): string {
  const mission = coaching.missions.find((row) => row.id === id);
  if (!mission) return id;
  return `${mission.label} · +${mission.xpReward} XP`;
}

const PLAY_DELTA_PRIORITY: Record<PlayDeltaKind, number> = {
  level: 0,
  achievement: 1,
  mission: 2,
  mark: 3,
};

/**
 * Keep the higher-priority delta when independent hydrations land in separate
 * effect runs, so the last-arriving fetch cannot drop an earlier event.
 */
export function mergePlayDelta(current: PlayDelta, next: PlayDelta): PlayDelta {
  const currentRank = PLAY_DELTA_PRIORITY[current.kind];
  const nextRank = PLAY_DELTA_PRIORITY[next.kind];
  if (nextRank === currentRank) return next;
  return nextRank < currentRank ? next : current;
}

/**
 * At most one line. Level beats achievement beats mission beats first mark.
 * First visit / missing cursor: no celebrate (do not replay history).
 */
export function diffPlaySeen(
  prev: PlaySeenCursor | null,
  next: PlaySeenCursor,
  coaching: CoachingState,
  gamification: GamificationStats,
): PlayDelta | null {
  if (!prev) return null;

  const prevClaimed =
    prev.dayUtc === next.dayUtc ? prev.claimedMissionIds : [];
  const newMissions = newestIds(prevClaimed, next.claimedMissionIds);
  const newAchievements = newestIds(
    prev.unlockedAchievementIds,
    next.unlockedAchievementIds,
  );
  const leveledUp = next.level > prev.level;
  const markedToday =
    Boolean(next.dayUtc) &&
    next.lastMarkUtcDay === next.dayUtc &&
    prev.lastMarkUtcDay !== next.dayUtc;

  if (leveledUp) {
    const line =
      toastFromMarkProgress(
        {
          markXp: 0,
          streakMultiplier: 1,
          leveledUp: true,
          previousLevel: next.level - 1,
          unlockedAchievementIds: newAchievements,
        },
        gamification.achievements,
      ) ?? `Level ${next.level}`;
    return { kind: "level", line };
  }

  if (newAchievements.length) {
    const line =
      toastFromMarkProgress(
        {
          markXp: 0,
          streakMultiplier: 1,
          leveledUp: false,
          previousLevel: next.level,
          unlockedAchievementIds: newAchievements,
        },
        gamification.achievements,
      ) ?? `${achievementTitle(newAchievements[0]!, gamification.achievements)} unlocked`;
    return { kind: "achievement", line };
  }

  if (newMissions.length) {
    return { kind: "mission", line: missionLine(coaching, newMissions[0]!) };
  }

  if (markedToday) {
    return { kind: "mark", line: "Marked today" };
  }

  return null;
}

/** Diff then persist the current cursor. */
export function takePlaySeenDelta(
  store: PlaySeenStorage,
  userId: string,
  coaching: CoachingState,
  gamification: GamificationStats,
): PlayDelta | null {
  const next = cursorFromState(coaching, gamification);
  const prev = readPlaySeen(store, userId);
  const delta = diffPlaySeen(prev, next, coaching, gamification);
  writePlaySeen(store, userId, next);
  return delta;
}
