/** Client types + fetch for GET /api/gamification. */

import { apiFetch } from "./apiBase";

export type AchievementKind = "streak" | "level" | "marks";

export type NextGoal = {
  id: string;
  kind: AchievementKind;
  title: string;
  detail: string;
  remaining: number;
};

export type AchievementPublic = {
  id: string;
  title: string;
  detail: string;
  kind: AchievementKind;
  threshold: number;
  unlocked: boolean;
};

export type MarkProgress = {
  markXp: number;
  streakMultiplier: number;
  leveledUp: boolean;
  previousLevel: number;
  unlockedAchievementIds: string[];
};

export type GamificationStats = {
  currentStreak: number;
  longestStreak: number;
  lifetimeXp: number;
  level: number;
  xpIntoLevel: number;
  xpToNext: number;
  lastMarkUtcDay: string | null;
  nextGoal: NextGoal | null;
  achievements: AchievementPublic[];
};

export type ParsedGamification = {
  stats: GamificationStats;
  progress: MarkProgress | null;
};

const KINDS = new Set<AchievementKind>(["streak", "level", "marks"]);

export function emptyGamificationStats(): GamificationStats {
  return {
    currentStreak: 0,
    longestStreak: 0,
    lifetimeXp: 0,
    level: 1,
    xpIntoLevel: 0,
    xpToNext: 1,
    lastMarkUtcDay: null,
    nextGoal: null,
    achievements: [],
  };
}

function finiteNonNeg(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function parseKind(value: unknown): AchievementKind | null {
  return typeof value === "string" && KINDS.has(value as AchievementKind)
    ? (value as AchievementKind)
    : null;
}

export function parseNextGoal(raw: unknown): NextGoal | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const kind = parseKind(row.kind);
  const remaining = finiteNonNeg(row.remaining);
  if (
    typeof row.id !== "string" ||
    !row.id ||
    !kind ||
    typeof row.title !== "string" ||
    !row.title.trim() ||
    typeof row.detail !== "string" ||
    remaining === null
  ) {
    return null;
  }
  return {
    id: row.id,
    kind,
    title: row.title.trim(),
    detail: row.detail.trim(),
    remaining,
  };
}

export function parseAchievements(raw: unknown): AchievementPublic[] {
  if (!Array.isArray(raw)) return [];
  const out: AchievementPublic[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const kind = parseKind(row.kind);
    const threshold = finiteNonNeg(row.threshold);
    if (
      typeof row.id !== "string" ||
      !row.id ||
      typeof row.title !== "string" ||
      !row.title.trim() ||
      typeof row.detail !== "string" ||
      !kind ||
      threshold === null
    ) {
      continue;
    }
    out.push({
      id: row.id,
      title: row.title.trim(),
      detail: row.detail.trim(),
      kind,
      threshold,
      unlocked: row.unlocked === true,
    });
  }
  return out;
}

export function parseMarkProgress(raw: unknown): MarkProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const markXp = finiteNonNeg(row.markXp);
  const streakMultiplier = finiteNonNeg(row.streakMultiplier);
  const previousLevel = finiteNonNeg(row.previousLevel);
  if (
    markXp === null ||
    streakMultiplier === null ||
    previousLevel === null ||
    typeof row.leveledUp !== "boolean" ||
    !Array.isArray(row.unlockedAchievementIds)
  ) {
    return null;
  }
  return {
    markXp,
    streakMultiplier,
    leveledUp: row.leveledUp,
    previousLevel,
    unlockedAchievementIds: row.unlockedAchievementIds.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    ),
  };
}

export function parseGamificationPayload(
  raw: unknown,
): ParsedGamification | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const currentStreak = finiteNonNeg(data.currentStreak);
  const longestStreak = finiteNonNeg(data.longestStreak);
  const lifetimeXp = finiteNonNeg(data.lifetimeXp);
  const level = finiteNonNeg(data.level);
  const xpIntoLevel = finiteNonNeg(data.xpIntoLevel);
  const xpToNext = finiteNonNeg(data.xpToNext);
  if (
    currentStreak === null ||
    longestStreak === null ||
    lifetimeXp === null ||
    level === null ||
    xpIntoLevel === null ||
    xpToNext === null ||
    xpToNext < 1
  ) {
    return null;
  }
  return {
    stats: {
      currentStreak,
      longestStreak,
      lifetimeXp,
      level: Math.max(1, level),
      xpIntoLevel,
      xpToNext,
      lastMarkUtcDay:
        typeof data.lastMarkUtcDay === "string" ? data.lastMarkUtcDay : null,
      nextGoal: parseNextGoal(data.nextGoal),
      achievements: parseAchievements(data.achievements),
    },
    progress: parseMarkProgress(data.progress),
  };
}

export function toastFromMarkProgress(
  progress: MarkProgress,
  achievements: AchievementPublic[],
): string | null {
  const names = progress.unlockedAchievementIds
    .map((id) => achievements.find((row) => row.id === id)?.title ?? id)
    .filter((title) => title.length > 0);
  if (progress.leveledUp && names.length) {
    return `Level ${progress.previousLevel + 1} — ${names[0]}`;
  }
  if (progress.leveledUp) {
    return `Level ${progress.previousLevel + 1}`;
  }
  if (names.length === 1) return `${names[0]} unlocked`;
  if (names.length > 1) return `${names[0]} + ${names.length - 1} more`;
  return null;
}

export async function fetchGamification(): Promise<GamificationStats | null> {
  try {
    const res = await apiFetch("/api/gamification");
    if (!res.ok) return null;
    const parsed = parseGamificationPayload(await res.json());
    return parsed?.stats ?? null;
  } catch {
    return null;
  }
}
