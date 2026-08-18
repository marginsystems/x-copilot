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
import {
  POST_COOLDOWN_MS,
  checkDeskPostLimit,
  dailyPostCap,
  recordDeskPost,
} from "./xPostLimits.ts";

describe("dailyPostCap", () => {
  it("starts at 5 and grows with level and streak, capped at 20", () => {
    assert.equal(dailyPostCap({ level: 1, currentStreak: 0 }), 5);
    assert.equal(dailyPostCap({ level: 3, currentStreak: 0 }), 6);
    assert.equal(dailyPostCap({ level: 3, currentStreak: 3 }), 7);
    assert.equal(dailyPostCap({ level: 3, currentStreak: 7 }), 8);
    assert.equal(dailyPostCap({ level: 99, currentStreak: 30 }), 20);
  });
});

describe("checkDeskPostLimit", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-post-limits-"));
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

  it("allows the first post of the day", () => {
    const got = checkDeskPostLimit({
      userId: "u1",
      level: 1,
      currentStreak: 0,
      nowMs: Date.parse("2026-08-19T12:00:00.000Z"),
    });
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.cap, 5);
    assert.equal(got.remainingToday, 5);
  });

  it("enforces the cooldown after a recent post", () => {
    const nowMs = Date.parse("2026-08-19T12:00:00.000Z");
    recordDeskPost({
      userId: "u1",
      tweetId: "1",
      inReplyToId: "2",
      atIso: new Date(nowMs - 30_000).toISOString(),
    });
    const got = checkDeskPostLimit({
      userId: "u1",
      level: 1,
      currentStreak: 0,
      nowMs,
    });
    assert.equal(got.ok, false);
    if (got.ok) return;
    assert.equal(got.error, "cooldown");
    assert.equal(
      got.retryAfterSec,
      Math.ceil((POST_COOLDOWN_MS - 30_000) / 1000),
    );
  });

  it("blocks once the daily cap is spent", () => {
    const nowMs = Date.parse("2026-08-19T12:00:00.000Z");
    for (let i = 0; i < 5; i++) {
      recordDeskPost({
        userId: "u1",
        tweetId: String(i),
        inReplyToId: "2",
        atIso: new Date(nowMs - POST_COOLDOWN_MS - 1_000 - i * 1_000).toISOString(),
      });
    }
    const got = checkDeskPostLimit({
      userId: "u1",
      level: 1,
      currentStreak: 0,
      nowMs,
    });
    assert.equal(got.ok, false);
    if (got.ok) return;
    assert.equal(got.error, "daily_cap");
    assert.equal(got.remainingToday, 0);
  });
});
