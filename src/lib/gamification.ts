/** Client types + fetch for GET /api/gamification. */

export type GamificationStats = {
  currentStreak: number;
  longestStreak: number;
  lifetimeXp: number;
  level: number;
  xpIntoLevel: number;
  xpToNext: number;
  lastMarkUtcDay: string | null;
};

export function emptyGamificationStats(): GamificationStats {
  return {
    currentStreak: 0,
    longestStreak: 0,
    lifetimeXp: 0,
    level: 1,
    xpIntoLevel: 0,
    xpToNext: 1,
    lastMarkUtcDay: null,
  };
}

function finiteNonNeg(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export async function fetchGamification(): Promise<GamificationStats | null> {
  try {
    const res = await fetch("/api/gamification");
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<GamificationStats>;
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
      currentStreak,
      longestStreak,
      lifetimeXp,
      level: Math.max(1, level),
      xpIntoLevel,
      xpToNext,
      lastMarkUtcDay:
        typeof data.lastMarkUtcDay === "string" ? data.lastMarkUtcDay : null,
    };
  } catch {
    return null;
  }
}
