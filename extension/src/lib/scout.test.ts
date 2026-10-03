import { describe, expect, it } from "vitest";
import {
  parseScoutStats,
  repliesOnUtcDay,
  SCOUT_MAX_CELL,
  SCOUT_MIN_CELL,
  SCOUT_SPRITE_SIZE,
  scoutLook,
  scoutSprite,
} from "./scout";

describe("parseScoutStats", () => {
  it("reads level and streak from the gamification answer", () => {
    expect(parseScoutStats({ level: 4, currentStreak: 6, lifetimeXp: 900 })).toEqual({ level: 4, streak: 6 });
  });

  it("rejects an answer without numeric level and streak", () => {
    expect(parseScoutStats(null)).toBeNull();
    expect(parseScoutStats({ level: "4", currentStreak: 6 })).toBeNull();
    expect(parseScoutStats({ level: 4, currentStreak: -1 })).toBeNull();
  });
});

describe("repliesOnUtcDay", () => {
  it("counts only replies posted on the current UTC day", () => {
    const now = Date.parse("2026-10-04T12:00:00.000Z");
    expect(
      repliesOnUtcDay(["2026-10-04T11:00:00.000Z", "2026-10-04T00:00:01.000Z", "2026-10-03T23:59:59.000Z"], now),
    ).toBe(2);
  });
});

describe("scoutLook", () => {
  it("naps without stats or glow until the desk is connected", () => {
    const look = scoutLook({ connected: false, repliesToday: 9, stats: { level: 9, streak: 9 } });
    expect(look).toMatchObject({ awake: false, glow: 0, sparkles: 0, scarf: false, facts: [] });
    expect(look.line).toContain("Connect your desk");
  });

  it("glows more with each reply today and caps at full charge", () => {
    const glow = (repliesToday: number) => scoutLook({ connected: true, repliesToday, stats: null }).glow;
    expect(glow(0)).toBe(0);
    expect(glow(3)).toBeGreaterThan(glow(1));
    expect(glow(6)).toBe(1);
    expect(glow(40)).toBe(1);
  });

  it("grows with level up to a fixed size", () => {
    const cell = (level: number) => scoutLook({ connected: true, repliesToday: 0, stats: { level, streak: 0 } }).cell;
    expect(cell(1)).toBe(SCOUT_MIN_CELL);
    expect(cell(4)).toBe(SCOUT_MIN_CELL + 1);
    expect(cell(50)).toBe(SCOUT_MAX_CELL);
  });

  it("powers up with a scarf at a 3 day streak and a bigger bulb at 7", () => {
    const look = (streak: number) => scoutLook({ connected: true, repliesToday: 0, stats: { level: 1, streak } });
    expect(look(2)).toMatchObject({ scarf: false, bigBulb: false });
    expect(look(3)).toMatchObject({ scarf: true, bigBulb: false });
    expect(look(7)).toMatchObject({ scarf: true, bigBulb: true });
  });

  it("encourages the first reply, then reports the day's count", () => {
    const line = (repliesToday: number, streak: number) =>
      scoutLook({ connected: true, repliesToday, stats: { level: 1, streak } }).line;
    expect(line(0, 0)).toContain("first reply");
    expect(line(0, 5)).toContain("Day 5");
    expect(line(2, 5)).toContain("2 down");
    expect(line(4, 5)).toContain("glowing");
    expect(line(8, 5)).toContain("fully charged");
  });

  it("shows today's count alone when gamification did not load", () => {
    expect(scoutLook({ connected: true, repliesToday: 2, stats: null }).facts).toEqual([{ label: "Today", value: "2" }]);
  });
});

describe("scoutSprite", () => {
  const plain = { awake: true, blink: false, scarf: false, bigBulb: false };
  const napping = { ...plain, awake: false };
  const variants = [plain, { awake: true, blink: true, scarf: true, bigBulb: true }, napping];

  it.each(variants)("is a square grid for %o", (variant) => {
    const rows = scoutSprite(variant);
    expect(rows).toHaveLength(SCOUT_SPRITE_SIZE);
    for (const row of rows) expect(row).toHaveLength(SCOUT_SPRITE_SIZE);
  });

  it("closes the eyes while napping and while blinking", () => {
    const eyes = (rows: string[]) => rows.join("").split("e").length - 1;
    const open = eyes(scoutSprite(plain));
    expect(eyes(scoutSprite({ ...plain, blink: true }))).toBeLessThan(open);
    expect(scoutSprite(napping)[7]).not.toContain("e");
  });
});
