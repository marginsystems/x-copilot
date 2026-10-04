import { isRecord } from "./typeGuards.ts";

export type ScoutStats = { level: number; streak: number };

function wholeNonNegative(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

export function parseScoutStats(raw: unknown): ScoutStats | null {
  if (!isRecord(raw)) return null;
  const level = wholeNonNegative(raw.level);
  const streak = wholeNonNegative(raw.currentStreak);
  if (level === null || streak === null) return null;
  return { level: Math.max(1, level), streak };
}

export function repliesOnUtcDay(replyAt: readonly string[], nowMs: number): number {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return replyAt.filter((iso) => iso.slice(0, 10) === day).length;
}

export function repliesTodayCount(
  serverCount: number | null | undefined,
  replyAt: readonly string[],
  nowMs: number,
): number {
  return Math.max(serverCount ?? 0, repliesOnUtcDay(replyAt, nowMs));
}

export const SCOUT_MIN_CELL = 3;
export const SCOUT_MAX_CELL = 5;
export const SCOUT_FULL_CHARGE_REPLIES = 6;
export const SCOUT_SCARF_STREAK = 3;
export const SCOUT_BIG_BULB_STREAK = 7;

export type ScoutLook = {
  awake: boolean;
  cell: number;
  glow: number;
  scarf: boolean;
  bigBulb: boolean;
  sparkles: number;
  repliesToday: number;
  line: string;
  facts: { label: string; value: string }[];
};

function scoutLine(repliesToday: number, streak: number): string {
  if (repliesToday >= SCOUT_FULL_CHARGE_REPLIES) return `${repliesToday} replies today. Scout is fully charged.`;
  if (repliesToday >= 3) return `${repliesToday} replies today. Scout is glowing.`;
  if (repliesToday >= 1) return `${repliesToday} down. Scout is warming up.`;
  if (streak > 0) return `Day ${streak} of your streak. One reply keeps it alive.`;
  return "Scout is ready. Your first reply today powers it up.";
}

export function scoutLook(opts: {
  connected: boolean;
  repliesToday: number;
  stats: ScoutStats | null;
}): ScoutLook {
  if (!opts.connected) {
    return {
      awake: false,
      cell: SCOUT_MIN_CELL,
      glow: 0,
      scarf: false,
      bigBulb: false,
      sparkles: 0,
      repliesToday: 0,
      line: "Scout is napping. Connect your desk to wake it up.",
      facts: [],
    };
  }
  const level = opts.stats?.level ?? 1;
  const streak = opts.stats?.streak ?? 0;
  const repliesToday = Math.max(0, Math.floor(opts.repliesToday));
  const facts = [{ label: "Today", value: String(repliesToday) }];
  if (opts.stats) {
    facts.push({ label: "Streak", value: `${streak}d` }, { label: "Level", value: String(level) });
  }
  return {
    awake: true,
    cell: Math.min(SCOUT_MAX_CELL, SCOUT_MIN_CELL + Math.floor((level - 1) / 3)),
    glow: Math.min(1, repliesToday / SCOUT_FULL_CHARGE_REPLIES),
    scarf: streak >= SCOUT_SCARF_STREAK,
    bigBulb: streak >= SCOUT_BIG_BULB_STREAK,
    sparkles: repliesToday >= 3 ? Math.min(SCOUT_FULL_CHARGE_REPLIES, repliesToday) : 0,
    repliesToday,
    line: scoutLine(repliesToday, streak),
    facts,
  };
}

export const SCOUT_SPRITE_SIZE = 16;

const BODY_ROWS: readonly string[] = [
  ".......aa.......",
  ".......aa.......",
  ".......oo.......",
  "....oooooooo....",
  "...obbbbbbbbo...",
  "..obhhbbbbbbbo..",
  "..obhbbbbbbbbo..",
  "..obbebbbbebbo..",
  "..obbebbbbebbo..",
  "..obcbbmmbbcbo..",
  "..obbbbbbbbbbo..",
  "..obbbbbbbbbbo..",
  "...obbbbbbbbo...",
  "....oooooooo....",
  "....ff....ff....",
  "...fff....fff...",
];

const BIG_BULB_ROW = "......aaaa......";
const OPEN_EYES_ROW = "..obbebbbbebbo..";
const NO_EYES_ROW = "..obbbbbbbbbbo..";
const SHUT_EYES_ROW = "..obeebbbbeebo..";
const SCARF_ROW = "..osssssssssso..";
const SCARF_TAIL_ROW = "..obbbbbbbbsso..";

export function scoutSprite(opts: {
  awake: boolean;
  blink: boolean;
  scarf: boolean;
  bigBulb: boolean;
}): string[] {
  const rows = [...BODY_ROWS];
  if (opts.bigBulb) {
    rows[0] = BIG_BULB_ROW;
    rows[1] = BIG_BULB_ROW;
  }
  if (!opts.awake) {
    rows[7] = NO_EYES_ROW;
    rows[8] = SHUT_EYES_ROW;
  } else if (opts.blink) {
    rows[7] = NO_EYES_ROW;
    rows[8] = OPEN_EYES_ROW;
  }
  if (opts.scarf) {
    rows[10] = SCARF_ROW;
    rows[11] = SCARF_TAIL_ROW;
  }
  return rows;
}
