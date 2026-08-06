import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyGamificationStats } from "./gamification.ts";

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
    });
  });
});
