import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseScoutStats,
  repliesOnUtcDay,
  repliesTodayCount,
  SCOUT_MAX_CELL,
  SCOUT_MIN_CELL,
  SCOUT_SPRITE_SIZE,
  scoutLook,
  scoutSprite,
} from "./scoutCompanion.ts";

await describe("parseScoutStats", () => {
  it("reads level and streak from the gamification answer", () => {
    assert.deepEqual(parseScoutStats({ level: 4, currentStreak: 6, lifetimeXp: 900 }), { level: 4, streak: 6 });
  }).catch(assert.fail);

  it("rejects an answer without numeric level and streak", () => {
    assert.equal(parseScoutStats(null), null);
    assert.equal(parseScoutStats({ level: "4", currentStreak: 6 }), null);
    assert.equal(parseScoutStats({ level: 4, currentStreak: -1 }), null);
  }).catch(assert.fail);
});

await describe("repliesOnUtcDay", () => {
  it("counts only replies posted on the current UTC day", () => {
    const now = Date.parse("2026-10-04T12:00:00.000Z");
    assert.equal(
      repliesOnUtcDay(["2026-10-04T11:00:00.000Z", "2026-10-04T00:00:01.000Z", "2026-10-03T23:59:59.000Z"], now),
      2,
    );
  }).catch(assert.fail);
});

await describe("repliesTodayCount", () => {
  const now = Date.parse("2026-10-04T12:00:00.000Z");

  it("uses the server's count for the day, not the one reply time the quick read carries", () => {
    assert.equal(repliesTodayCount(69, ["2026-10-04T11:00:00.000Z"], now), 69);
  }).catch(assert.fail);

  it("counts a reply the panel has seen that the server has not counted yet", () => {
    const seen = ["2026-10-04T11:00:00.000Z", "2026-10-04T10:00:00.000Z", "2026-10-04T09:00:00.000Z"];
    assert.equal(repliesTodayCount(2, seen, now), 3);
  }).catch(assert.fail);

  it("falls back to the reply times on a server that sends no count", () => {
    assert.equal(repliesTodayCount(null, ["2026-10-04T11:00:00.000Z"], now), 1);
    assert.equal(repliesTodayCount(undefined, [], now), 0);
  }).catch(assert.fail);
});

await describe("scoutLook", () => {
  it("naps without stats or glow until the desk is connected", () => {
    const look = scoutLook({ connected: false, repliesToday: 9, stats: { level: 9, streak: 9 } });
    assert.equal(look.awake, false);
    assert.equal(look.glow, 0);
    assert.equal(look.sparkles, 0);
    assert.equal(look.scarf, false);
    assert.deepEqual(look.facts, []);
    assert.match(look.line, /Connect your desk/);
  }).catch(assert.fail);

  it("glows more with each reply today and caps at full charge", () => {
    const glow = (repliesToday: number) => scoutLook({ connected: true, repliesToday, stats: null }).glow;
    assert.equal(glow(0), 0);
    assert.ok(glow(3) > glow(1));
    assert.equal(glow(6), 1);
    assert.equal(glow(40), 1);
  }).catch(assert.fail);

  it("grows with level up to a fixed size", () => {
    const cell = (level: number) => scoutLook({ connected: true, repliesToday: 0, stats: { level, streak: 0 } }).cell;
    assert.equal(cell(1), SCOUT_MIN_CELL);
    assert.equal(cell(4), SCOUT_MIN_CELL + 1);
    assert.equal(cell(50), SCOUT_MAX_CELL);
  }).catch(assert.fail);

  it("powers up with a scarf at a 3 day streak and a bigger bulb at 7", () => {
    const powers = (streak: number) => {
      const look = scoutLook({ connected: true, repliesToday: 0, stats: { level: 1, streak } });
      return { scarf: look.scarf, bigBulb: look.bigBulb };
    };
    assert.deepEqual(powers(2), { scarf: false, bigBulb: false });
    assert.deepEqual(powers(3), { scarf: true, bigBulb: false });
    assert.deepEqual(powers(7), { scarf: true, bigBulb: true });
  }).catch(assert.fail);

  it("encourages the first reply, then reports the day's count", () => {
    const line = (repliesToday: number, streak: number) =>
      scoutLook({ connected: true, repliesToday, stats: { level: 1, streak } }).line;
    assert.match(line(0, 0), /first reply/);
    assert.match(line(0, 5), /Day 5/);
    assert.match(line(2, 5), /2 down/);
    assert.match(line(4, 5), /glowing/);
    assert.match(line(8, 5), /fully charged/);
  }).catch(assert.fail);

  it("shows today's count alone when gamification did not load", () => {
    assert.deepEqual(scoutLook({ connected: true, repliesToday: 2, stats: null }).facts, [
      { label: "Today", value: "2" },
    ]);
  }).catch(assert.fail);
});

await describe("scoutSprite", () => {
  const plain = { awake: true, blink: false, scarf: false, bigBulb: false };
  const napping = { ...plain, awake: false };
  const variants = [plain, { awake: true, blink: true, scarf: true, bigBulb: true }, napping];

  it("is a square grid in every variant", () => {
    for (const variant of variants) {
      const rows = scoutSprite(variant);
      assert.equal(rows.length, SCOUT_SPRITE_SIZE);
      for (const row of rows) assert.equal(row.length, SCOUT_SPRITE_SIZE);
    }
  }).catch(assert.fail);

  it("closes the eyes while napping and while blinking", () => {
    const eyes = (rows: string[]) => rows.join("").split("e").length - 1;
    const open = eyes(scoutSprite(plain));
    assert.ok(eyes(scoutSprite({ ...plain, blink: true })) < open);
    assert.ok(!scoutSprite(napping)[7]?.includes("e"));
  }).catch(assert.fail);
});
