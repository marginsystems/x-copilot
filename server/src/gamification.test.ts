import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyMarkToGamification,
  applyT24hBonus,
  bonusXpFromT24h,
  emptyGamificationState,
  getGamification,
  levelFromXp,
  prevUtcDayKey,
  recordMarkGamification,
  recordT24hBonusGamification,
  seedGamificationFromHistory,
  utcDayKey,
  xpProgress,
  type GamificationState,
} from "./gamification.ts";
import { markInteracted } from "./interactionStore.ts";
import type { Interaction } from "./interactionStore.ts";

describe("utcDayKey / prevUtcDayKey", () => {
  it("formats UTC calendar days", () => {
    assert.equal(utcDayKey(Date.parse("2026-08-05T23:30:00.000Z")), "2026-08-05");
    assert.equal(utcDayKey(Date.parse("2026-08-06T00:15:00.000Z")), "2026-08-06");
    assert.equal(prevUtcDayKey("2026-08-06"), "2026-08-05");
  });
});

describe("levelFromXp / xpProgress", () => {
  it("matches 1 + floor(sqrt(xp))", () => {
    assert.equal(levelFromXp(0), 1);
    assert.equal(levelFromXp(1), 2);
    assert.equal(levelFromXp(3), 2);
    assert.equal(levelFromXp(4), 3);
    assert.equal(levelFromXp(9), 4);
    assert.deepEqual(xpProgress(0), { level: 1, xpIntoLevel: 0, xpToNext: 1 });
    assert.deepEqual(xpProgress(1), { level: 2, xpIntoLevel: 0, xpToNext: 3 });
    assert.deepEqual(xpProgress(5), { level: 3, xpIntoLevel: 1, xpToNext: 5 });
  });
});

describe("bonusXpFromT24h", () => {
  it("scales views/100 + likes capped at 5", () => {
    assert.equal(bonusXpFromT24h({ views: 0, likes: 0 }), 0);
    assert.equal(bonusXpFromT24h({ views: 250, likes: 1 }), 3);
    assert.equal(bonusXpFromT24h({ views: 1000, likes: 10 }), 5);
    assert.equal(bonusXpFromT24h({}), 0);
  });
});

describe("applyMarkToGamification", () => {
  it("starts streak at 1 and awards mark XP", () => {
    const day = Date.parse("2026-08-06T12:00:00.000Z");
    const { state, awarded } = applyMarkToGamification(
      emptyGamificationState(day),
      day,
    );
    assert.equal(awarded.markXp, 1);
    assert.equal(awarded.currentStreak, 1);
    assert.equal(state.lifetimeXp, 1);
    assert.equal(state.lastMarkUtcDay, "2026-08-06");
  });

  it("keeps streak on same UTC day but still awards XP", () => {
    const t1 = Date.parse("2026-08-06T01:00:00.000Z");
    const t2 = Date.parse("2026-08-06T20:00:00.000Z");
    let state = applyMarkToGamification(emptyGamificationState(t1), t1).state;
    state = applyMarkToGamification(state, t2).state;
    assert.equal(state.currentStreak, 1);
    assert.equal(state.lifetimeXp, 2);
  });

  it("increments streak on consecutive UTC days", () => {
    const d1 = Date.parse("2026-08-05T12:00:00.000Z");
    const d2 = Date.parse("2026-08-06T12:00:00.000Z");
    let state = applyMarkToGamification(emptyGamificationState(d1), d1).state;
    state = applyMarkToGamification(state, d2).state;
    assert.equal(state.currentStreak, 2);
    assert.equal(state.longestStreak, 2);
    assert.equal(state.lifetimeXp, 2);
  });

  it("resets streak after a missed UTC day", () => {
    const d1 = Date.parse("2026-08-04T12:00:00.000Z");
    const d3 = Date.parse("2026-08-06T12:00:00.000Z");
    let state = applyMarkToGamification(emptyGamificationState(d1), d1).state;
    state = applyMarkToGamification(state, d3).state;
    assert.equal(state.currentStreak, 1);
    assert.equal(state.longestStreak, 1);
    assert.equal(state.lifetimeXp, 2);
  });

  it("re-marking the same thread on a later day awards XP and advances the streak", () => {
    const d1 = Date.parse("2026-08-05T12:00:00.000Z");
    const d2 = Date.parse("2026-08-06T12:00:00.000Z");
    let state = applyMarkToGamification(
      emptyGamificationState(d1),
      d1,
      "t1",
    ).state;
    assert.equal(state.currentStreak, 1);
    assert.equal(state.lifetimeXp, 1);
    state = applyMarkToGamification(state, d2, "t1").state;
    assert.equal(state.currentStreak, 2);
    assert.equal(state.longestStreak, 2);
    assert.equal(state.lifetimeXp, 2);
    // Replaying the original mark (same threadId + at) stays idempotent.
    const replay = applyMarkToGamification(state, d1, "t1");
    assert.equal(replay.awarded.markXp, 0);
    assert.equal(replay.state.lifetimeXp, 2);
  });

  it("credits XP only for a backdated mark without regressing the cursor", () => {
    const d1 = Date.parse("2026-08-05T12:00:00.000Z");
    const d3 = Date.parse("2026-08-07T12:00:00.000Z");
    // Ledger already advanced to D2 via thread "b"; thread "a"'s D1 mark
    // soft-failed so it is absent from markAwardedThreadIds.
    let state: GamificationState = {
      ...emptyGamificationState(d1),
      currentStreak: 1,
      longestStreak: 1,
      lastMarkUtcDay: "2026-08-06",
      lifetimeXp: 1,
      markAwardedThreadIds: ["b"],
    };

    // Replay the soft-failed D1 mark after the ledger already moved to D2.
    state = applyMarkToGamification(state, d1, "a").state;
    assert.equal(state.currentStreak, 1);
    assert.equal(state.lastMarkUtcDay, "2026-08-06");
    assert.equal(state.lifetimeXp, 2);
    assert.deepEqual(state.markAwardedThreadIds, [
      "b",
      "a:2026-08-05T12:00:00.000Z",
    ]);

    // A D3 mark must still be consecutive with the D2 cursor.
    state = applyMarkToGamification(state, d3, "c").state;
    assert.equal(state.currentStreak, 2);
    assert.equal(state.lastMarkUtcDay, "2026-08-07");
    assert.equal(state.lifetimeXp, 3);
  });
});

describe("applyT24hBonus", () => {
  it("awards once per threadId", () => {
    const now = Date.parse("2026-08-06T12:00:00.000Z");
    let state = emptyGamificationState(now);
    const first = applyT24hBonus(
      state,
      "t1",
      { views: 200, likes: 1 },
      now,
    );
    assert.equal(first.bonusXp, 3);
    state = first.state;
    const second = applyT24hBonus(
      state,
      "t1",
      { views: 900, likes: 9 },
      now,
    );
    assert.equal(second.bonusXp, 0);
    assert.equal(second.state.lifetimeXp, 3);
  });
});

describe("seedGamificationFromHistory", () => {
  it("replays marks and t24h bonuses oldest-first", () => {
    const rows: Interaction[] = [
      {
        threadId: "a",
        author: "@a",
        authorKey: "a",
        at: "2026-08-05T10:00:00.000Z",
        source: "manual",
        stats: {
          t24h: {
            views: 100,
            likes: 0,
            sampledAt: "2026-08-06T10:00:00.000Z",
          },
        },
      },
      {
        threadId: "b",
        author: "@b",
        authorKey: "b",
        at: "2026-08-06T10:00:00.000Z",
        source: "manual",
      },
    ];
    const state = seedGamificationFromHistory(
      rows,
      Date.parse("2026-08-06T12:00:00.000Z"),
    );
    assert.equal(state.currentStreak, 2);
    // 2 marks + 1 bonus (floor(100/100)+0)
    assert.equal(state.lifetimeXp, 3);
    assert.deepEqual(state.bonusAwardedThreadIds, ["a"]);
  });
});

describe("recordMarkGamification / getGamification", () => {
  let dir: string;
  let gamificationPath: string;
  let interactionStorePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-copilot-game-"));
    gamificationPath = join(dir, "gamification.json");
    interactionStorePath = join(dir, "interactions.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists mark XP and serves GET snapshot", async () => {
    const now = Date.parse("2026-08-06T12:00:00.000Z");
    await markInteracted({
      threadId: "t1",
      author: "@x",
      replyId: "r1",
      replyUrl: "https://x.com/me/status/r1",
      nowMs: now,
      storePath: interactionStorePath,
    });
    const afterMark = await recordMarkGamification({
      gamificationPath,
      interactionStorePath,
      nowMs: now,
    });
    assert.equal(afterMark.lifetimeXp, 1);
    assert.equal(afterMark.currentStreak, 1);

    const snap = await getGamification({
      gamificationPath,
      interactionStorePath,
    });
    assert.equal(snap.lifetimeXp, 1);
    assert.equal(snap.level, 2);
  });

  it("records idempotent t24h bonus", async () => {
    const now = Date.parse("2026-08-06T12:00:00.000Z");
    await recordMarkGamification({
      gamificationPath,
      interactionStorePath,
      nowMs: now,
    });
    const first = await recordT24hBonusGamification({
      threadId: "t1",
      snapshot: { views: 500, likes: 2 },
      gamificationPath,
      interactionStorePath,
      nowMs: now,
    });
    // mark 1 + min(5, 5+2)=5 → 6
    assert.equal(first.lifetimeXp, 6);
    const second = await recordT24hBonusGamification({
      threadId: "t1",
      snapshot: { views: 900, likes: 9 },
      gamificationPath,
      interactionStorePath,
      nowMs: now,
    });
    assert.equal(second.lifetimeXp, 6);
  });
});
