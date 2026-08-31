import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import type { CoachingSnapshot } from "./coachingSnapshot.ts";
import {
  listMissionsWithProgress,
  progressForMetric,
} from "./dailyMissions.ts";
import { getGamification } from "./gamification.ts";

const NOW_MS = Date.parse("2026-08-26T12:00:00.000Z");

function snapshot(
  partial: Partial<CoachingSnapshot> = {},
): CoachingSnapshot {
  return {
    dayUtc: "2026-08-26",
    marksToday: 0,
    originalsToday: 0,
    repliesPostedToday: 0,
    quotesToday: 0,
    deskPostsToday: 0,
    takeoffsToday: 0,
    suggestions: { total: 0, post: 0, quote: 0, repost: 0, reply: 0 },
    streak: 1,
    lastMarkUtcDay: "2026-08-26",
    level: 1,
    lifetimeXp: 0,
    ...partial,
  };
}

describe("dailyMissions", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-missions-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("maps snapshot counters onto mission metrics", () => {
    const snap = snapshot({
      marksToday: 2,
      originalsToday: 1,
      takeoffsToday: 0,
    });
    assert.equal(progressForMetric(snap, "marks"), 2);
    assert.equal(progressForMetric(snap, "originals"), 1);
  });

  it("seeds today and awards XP once when a mission completes", async () => {
    const gamificationPath = join(dir, "g.json");
    const first = await listMissionsWithProgress({
      userId: "u1",
      snapshot: snapshot({ marksToday: 2 }),
      nowMs: NOW_MS,
      gamificationPath,
    });
    const mark = first.find((m) => m.id === "mark_2");
    assert.ok(mark);
    assert.equal(mark.completed, true);
    assert.equal(mark.claimed, true);
    assert.equal(first.find((m) => m.id === "takeoff_1"), undefined);
    const after = await getGamification({
      userId: "u1",
      nowMs: NOW_MS,
      gamificationPath,
    });
    assert.equal(after.lifetimeXp, 4);

    const second = await listMissionsWithProgress({
      userId: "u1",
      snapshot: snapshot({ marksToday: 2 }),
      nowMs: NOW_MS,
      gamificationPath,
    });
    const again = second.find((m) => m.id === "mark_2");
    assert.equal(again?.claimed, true);
    const afterAgain = await getGamification({
      userId: "u1",
      nowMs: NOW_MS,
      gamificationPath,
    });
    assert.equal(afterAgain.lifetimeXp, 4);
  });
});
