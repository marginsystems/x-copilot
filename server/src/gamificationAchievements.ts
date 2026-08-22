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
