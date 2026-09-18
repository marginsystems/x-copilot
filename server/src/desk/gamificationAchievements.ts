import {
  levelFromXp,
  lifetimeMarksOf,
  markXpForStreak,
  xpProgress,
  type GamificationState,
} from "./gamificationXp.js";

export type AchievementKind = "streak" | "level" | "marks";

export type AchievementDef = {
  id: string;
  title: string;
  detail: string;
  kind: AchievementKind;
  threshold: number;
};

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: "first_mark",
    title: "First reply",
    detail: "Mark your first interacted thread",
    kind: "marks",
    threshold: 1,
  },
  {
    id: "marks_10",
    title: "Warming up",
    detail: "10 marked replies",
    kind: "marks",
    threshold: 10,
  },
  {
    id: "marks_50",
    title: "Regular",
    detail: "50 marked replies",
    kind: "marks",
    threshold: 50,
  },
  {
    id: "marks_100",
    title: "Century",
    detail: "100 marked replies",
    kind: "marks",
    threshold: 100,
  },
  {
    id: "marks_250",
    title: "Deep bench",
    detail: "250 marked replies",
    kind: "marks",
    threshold: 250,
  },
  {
    id: "streak_3",
    title: "On a run",
    detail: "3 UTC days in a row",
    kind: "streak",
    threshold: 3,
  },
  {
    id: "streak_7",
    title: "Week locked",
    detail: "7 UTC days in a row",
    kind: "streak",
    threshold: 7,
  },
  {
    id: "streak_14",
    title: "Fortnight",
    detail: "14 UTC days in a row",
    kind: "streak",
    threshold: 14,
  },
  {
    id: "streak_30",
    title: "Month locked",
    detail: "30 UTC days in a row",
    kind: "streak",
    threshold: 30,
  },
  {
    id: "level_5",
    title: "Scout",
    detail: "Reach level 5",
    kind: "level",
    threshold: 5,
  },
  {
    id: "level_10",
    title: "Operator",
    detail: "Reach level 10",
    kind: "level",
    threshold: 10,
  },
  {
    id: "level_15",
    title: "Veteran",
    detail: "Reach level 15",
    kind: "level",
    threshold: 15,
  },
  {
    id: "level_25",
    title: "Ace",
    detail: "Reach level 25",
    kind: "level",
    threshold: 25,
  },
];

export type AchievementPublic = AchievementDef & {
  unlocked: boolean;
};

export type NextGoal = {
  id: string;
  kind: AchievementKind;
  title: string;
  detail: string;
  remaining: number;
};

export type MarkProgress = {
  markXp: number;
  streakMultiplier: number;
  leveledUp: boolean;
  previousLevel: number;
  unlockedAchievementIds: string[];
};

export type LeaderboardRow = {
  userId: string;
  lifetimeXp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  lifetimeMarks: number;
};

export type GamificationPublic = {
  currentStreak: number;
  longestStreak: number;
  lifetimeXp: number;
  level: number;
  xpIntoLevel: number;
  xpToNext: number;
  lastMarkUtcDay: string | null;
  lifetimeMarks: number;
  streakMultiplier: number;
  markXpAtStreak: number;
  nextGoal: NextGoal;
  achievements: AchievementPublic[];
  progress?: MarkProgress;
};

export function achievementValue(
  def: AchievementDef,
  state: GamificationState,
): number {
  if (def.kind === "streak") {
    return Math.max(state.currentStreak, state.longestStreak);
  }
  if (def.kind === "level") return levelFromXp(state.lifetimeXp);
  return lifetimeMarksOf(state);
}

export function achievementUnlocked(
  def: AchievementDef,
  state: GamificationState,
): boolean {
  return achievementValue(def, state) >= def.threshold;
}

export function listAchievements(state: GamificationState): AchievementPublic[] {
  return ACHIEVEMENTS.map((def) => ({
    ...def,
    unlocked: achievementUnlocked(def, state),
  }));
}

export function unlockedAchievementIds(state: GamificationState): string[] {
  return ACHIEVEMENTS.filter((def) => achievementUnlocked(def, state)).map(
    (def) => def.id,
  );
}

export function pickNextGoal(state: GamificationState): NextGoal {
  const progress = xpProgress(state.lifetimeXp);
  const xpRemaining = Math.max(0, progress.xpToNext - progress.xpIntoLevel);
  const nextMarkXp = markXpForStreak(Math.max(1, state.currentStreak));
  const nextLevelId = `level_${progress.level + 1}`;
  const nextLevelDef = ACHIEVEMENTS.find((def) => def.id === nextLevelId);
  if (nextLevelDef && xpRemaining > 0 && xpRemaining <= nextMarkXp) {
    return {
      id: nextLevelDef.id,
      kind: "level",
      title: nextLevelDef.title,
      detail: `${xpRemaining} XP to go`,
      remaining: xpRemaining,
    };
  }

  const nextStreak = ACHIEVEMENTS.find(
    (def) => def.kind === "streak" && !achievementUnlocked(def, state),
  );
  if (nextStreak && state.currentStreak > 0) {
    return {
      id: nextStreak.id,
      kind: "streak",
      title: nextStreak.title,
      detail: `${nextStreak.threshold - state.currentStreak} more UTC day(s)`,
      remaining: Math.max(0, nextStreak.threshold - state.currentStreak),
    };
  }

  const nextMarks = ACHIEVEMENTS.find(
    (def) => def.kind === "marks" && !achievementUnlocked(def, state),
  );
  if (nextMarks) {
    const have = lifetimeMarksOf(state);
    return {
      id: nextMarks.id,
      kind: "marks",
      title: nextMarks.title,
      detail: `${nextMarks.threshold - have} more mark(s)`,
      remaining: Math.max(0, nextMarks.threshold - have),
    };
  }

  // Every catalog goal is out of reach or already unlocked; keep nextGoal.id
  // resolvable against ACHIEVEMENTS by pointing at the final level badge.
  const lastLevelDef =
    nextLevelDef ?? [...ACHIEVEMENTS].reverse().find((def) => def.kind === "level");
  return {
    id: lastLevelDef?.id ?? "level_25",
    kind: "level",
    title: `Level ${progress.level + 1}`,
    detail: `${xpRemaining} XP to go`,
    remaining: xpRemaining,
  };
}

export function toLeaderboardRow(
  userId: string,
  state: GamificationState,
): LeaderboardRow {
  return {
    userId,
    lifetimeXp: state.lifetimeXp,
    level: levelFromXp(state.lifetimeXp),
    currentStreak: state.currentStreak,
    longestStreak: state.longestStreak,
    lifetimeMarks: lifetimeMarksOf(state),
  };
}

export function toPublicGamification(
  state: GamificationState,
  opts?: { progress?: MarkProgress },
): GamificationPublic {
  const progress = xpProgress(state.lifetimeXp);
  const streakMultiplier = markXpForStreak(Math.max(1, state.currentStreak));
  const pub: GamificationPublic = {
    currentStreak: state.currentStreak,
    longestStreak: state.longestStreak,
    lifetimeXp: state.lifetimeXp,
    level: progress.level,
    xpIntoLevel: progress.xpIntoLevel,
    xpToNext: progress.xpToNext,
    lastMarkUtcDay: state.lastMarkUtcDay,
    lifetimeMarks: lifetimeMarksOf(state),
    streakMultiplier,
    markXpAtStreak: streakMultiplier,
    nextGoal: pickNextGoal(state),
    achievements: listAchievements(state),
  };
  if (opts?.progress) pub.progress = opts.progress;
  return pub;
}
