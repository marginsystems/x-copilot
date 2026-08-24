import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  emptyGamificationStats,
  parseGamificationPayload,
  toastFromMarkProgress,
} from "./gamification.ts";

const nextGoal = {
  id: "first_mark",
  kind: "marks",
  title: "First reply",
  detail: "1 more mark(s)",
  remaining: 1,
};

const payload = {
  currentStreak: 2,
  longestStreak: 4,
  lifetimeXp: 8,
  level: 2,
  xpIntoLevel: 3,
  xpToNext: 10,
  lastMarkUtcDay: "2026-08-24",
  nextGoal,
  achievements: [
    {
      id: "first_mark",
      title: "First reply",
      detail: "Mark your first interacted thread",
      kind: "marks",
      threshold: 1,
      unlocked: true,
    },
  ],
};

describe("emptyGamificationStats", () => {
  it("starts at level 1 with zero streak", () => {
    assert.deepEqual(emptyGamificationStats(), {
      currentStreak: 0,
      longestStreak: 0,
      lifetimeXp: 0,
      level: 1,
      xpIntoLevel: 0,
      xpToNext: 1,
      lastMarkUtcDay: null,
      nextGoal: null,
      achievements: [],
    });
  });
});

describe("parseGamificationPayload", () => {
  it("keeps nextGoal and achievements and ignores hydrate progress", () => {
    const parsed = parseGamificationPayload(payload);
    assert.equal(parsed?.stats.level, 2);
    assert.deepEqual(parsed?.stats.nextGoal, nextGoal);
    assert.equal(parsed?.stats.achievements[0]?.id, "first_mark");
    assert.equal(parsed?.progress, null);
  });

  it("reads mark progress without using it as a hydrate toast", () => {
    const parsed = parseGamificationPayload({
      ...payload,
      progress: {
        markXp: 2,
        streakMultiplier: 2,
        leveledUp: true,
        previousLevel: 1,
        unlockedAchievementIds: ["first_mark"],
      },
    });
    assert.equal(parsed?.progress?.leveledUp, true);
    assert.equal(
      toastFromMarkProgress(parsed!.progress!, parsed!.stats.achievements),
      "Level 2 — First reply",
    );
  });

  it("does not toast a mark that only awarded XP", () => {
    assert.equal(
      toastFromMarkProgress(
        {
          markXp: 1,
          streakMultiplier: 1,
          leveledUp: false,
          previousLevel: 1,
          unlockedAchievementIds: [],
        },
        [],
      ),
      null,
    );
  });

  it("rejects a broken payload", () => {
    assert.equal(parseGamificationPayload({ level: 1 }), null);
  });
});
