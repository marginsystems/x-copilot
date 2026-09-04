import {
  replyPaceLocked,
  replyPaceRemainingMs,
} from "./replyPace";

export const DESK_GAUGE_LABEL = "desk gauge";
export const POST_DAILY_CAP_MIN = 5;
export const POST_DAILY_CAP_MAX = 20;
/** Same window size the public X ranking features use for recent actions. */
export const RATE_WINDOW = 500;

const INBOUND_SAMPLE_SIZE = 5;
const MIN_INBOUND_SAMPLES = 3;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type DeskGaugeBand = "cool" | "warm" | "hot";

export type InstrumentDelta = {
  pct24h: number | null;
  pct7d: number | null;
};

export type DeskInstrumentMark = {
  /** Epoch milliseconds. Prefer postedAtMs when both times are present. */
  atMs: number;
  postedAtMs?: number;
  t24hViews?: number;
  t24hLikes?: number;
};

export type DeskInstrumentInput = {
  nowMs: number;
  marks: DeskInstrumentMark[];
  /** Last 500 reply times when the server sent them. Else `marks`. */
  replyAtMs?: number[];
  originalAtMs?: number[];
  postAtMs?: number[];
  postsToday: number;
  originalsToday: number;
  /** From dailyPostCap({ level, currentStreak }). */
  dailyPostCap: number;
  /** sessionStorage until from replyPace. */
  replyPaceUntil: number | null;
};

export type DeskInstruments = {
  windowSize: number;
  repliesPerHour: number;
  repliesPerHourDelta: InstrumentDelta;
  repliesUtcDay: number;
  repliesUtcDayDelta: InstrumentDelta;
  originalsToday: number;
  originalsTodayDelta: InstrumentDelta;
  postsToday: number;
  postsTodayDelta: InstrumentDelta;
  dailyPostCap: number;
  paceRemainingMs: number;
  paceLocked: boolean;
  postsBand: DeskGaugeBand;
  inboundBand: DeskGaugeBand | null;
};

export type DeskHistoryMarkSource = {
  at: string;
  postedAt?: string;
  stats?: {
    t24h?: {
      views?: number;
      likes?: number;
    };
  };
};

export function parseInstrumentTimes(rows: string[] | undefined): number[] {
  if (!rows) return [];
  return rows.map((row) => Date.parse(row)).filter((n) => Number.isFinite(n));
}

export function markFromHistory(
  entry: DeskHistoryMarkSource,
): DeskInstrumentMark {
  return {
    atMs: Date.parse(entry.at),
    postedAtMs:
      entry.postedAt === undefined ? undefined : Date.parse(entry.postedAt),
    t24hViews: entry.stats?.t24h?.views,
    t24hLikes: entry.stats?.t24h?.likes,
  };
}

export function utcDayStartMs(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
}

/** Same formula as `server/src/xPostLimits.ts` — keep the fixtures in lockstep. */
export function dailyPostCap(opts: {
  level: number;
  currentStreak: number;
}): number {
  const level = Math.max(1, Math.floor(opts.level));
  const streak = Math.max(0, Math.floor(opts.currentStreak));
  const base = POST_DAILY_CAP_MIN + Math.floor((level - 1) / 2);
  const streakBonus = streak >= 7 ? 2 : streak >= 3 ? 1 : 0;
  return Math.min(POST_DAILY_CAP_MAX, base + streakBonus);
}

function markTime(mark: DeskInstrumentMark): number {
  return mark.postedAtMs ?? mark.atMs;
}

function finiteTimes(times: number[]): number[] {
  return times.filter((time) => Number.isFinite(time));
}

function countOnUtcDay(times: number[], dayStartMs: number): number {
  const dayEnd = dayStartMs + DAY_MS;
  return times.filter((time) => time >= dayStartMs && time < dayEnd).length;
}

function countInRange(
  times: number[],
  afterMs: number,
  throughMs: number,
): number {
  return times.filter((time) => time > afterMs && time <= throughMs).length;
}

/**
 * Trailing actions / hour over the last `window` times ending at `nowMs`.
 * Span is now minus the oldest time in that window, floored at one minute
 * so a burst at t=now does not become Infinity.
 */
export function trailingPerHour(
  timesMs: number[],
  nowMs: number,
  window = RATE_WINDOW,
): number {
  const slice = finiteTimes(timesMs)
    .filter((time) => time <= nowMs)
    .sort((a, b) => b - a)
    .slice(0, window);
  if (slice.length === 0) return 0;
  const oldest = slice[slice.length - 1];
  const spanMs = Math.max(nowMs - oldest, MINUTE_MS);
  return slice.length / (spanMs / HOUR_MS);
}

/** Null when a percent is not defined (previous is 0 and current is not). */
export function pctDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function formatPerHour(rate: number): string {
  if (!Number.isFinite(rate)) return "0.00";
  return rate.toFixed(2);
}

export function formatPctDelta(pct: number | null): string | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  const abs = Math.abs(pct);
  const body = abs >= 10 ? String(Math.round(abs)) : abs.toFixed(1);
  return `${body}%`;
}

function inboundBand(
  marks: DeskInstrumentMark[],
): DeskGaugeBand | null {
  const sampled = marks
    .filter(
      (mark) =>
        mark.t24hViews !== undefined || mark.t24hLikes !== undefined,
    )
    .slice(0, INBOUND_SAMPLE_SIZE);

  if (sampled.length < MIN_INBOUND_SAMPLES) return null;
  if (
    sampled.every(
      (mark) => (mark.t24hViews ?? 0) === 0 && (mark.t24hLikes ?? 0) === 0,
    )
  ) {
    return "hot";
  }
  if (sampled.every((mark) => (mark.t24hViews ?? 0) > 0)) {
    return "cool";
  }
  return "warm";
}

function postsBand(postsToday: number, cap: number): DeskGaugeBand {
  if (postsToday < cap) return "cool";
  if (postsToday === cap) return "warm";
  return "hot";
}

function countDelta(
  times: number[],
  nowMs: number,
): InstrumentDelta {
  const today = utcDayStartMs(nowMs);
  const yesterday = today - DAY_MS;
  return {
    pct24h: pctDelta(
      countOnUtcDay(times, today),
      countOnUtcDay(times, yesterday),
    ),
    pct7d: pctDelta(
      countInRange(times, nowMs - 7 * DAY_MS, nowMs),
      countInRange(times, nowMs - 14 * DAY_MS, nowMs - 7 * DAY_MS),
    ),
  };
}

function rateDelta(times: number[], nowMs: number): InstrumentDelta {
  return {
    pct24h: pctDelta(
      trailingPerHour(times, nowMs),
      trailingPerHour(times, nowMs - DAY_MS),
    ),
    pct7d: pctDelta(
      trailingPerHour(times, nowMs),
      trailingPerHour(times, nowMs - 7 * DAY_MS),
    ),
  };
}

export function readDeskInstruments(
  input: DeskInstrumentInput,
): DeskInstruments {
  const marks = input.marks
    .filter((mark) => Number.isFinite(markTime(mark)))
    .sort((a, b) => markTime(b) - markTime(a));
  const replyTimes = finiteTimes(
    input.replyAtMs && input.replyAtMs.length > 0
      ? input.replyAtMs
      : marks.map(markTime),
  );
  const originalTimes = finiteTimes(input.originalAtMs ?? []);
  const postTimes = finiteTimes(input.postAtMs ?? []);
  const window = replyTimes
    .filter((time) => time <= input.nowMs)
    .sort((a, b) => b - a)
    .slice(0, RATE_WINDOW);
  const dayStart = utcDayStartMs(input.nowMs);

  return {
    windowSize: window.length,
    repliesPerHour: trailingPerHour(replyTimes, input.nowMs),
    repliesPerHourDelta: rateDelta(replyTimes, input.nowMs),
    repliesUtcDay: replyTimes.filter(
      (time) => time >= dayStart && time <= input.nowMs,
    ).length,
    repliesUtcDayDelta: countDelta(replyTimes, input.nowMs),
    originalsToday: input.originalsToday,
    originalsTodayDelta:
      originalTimes.length > 0
        ? countDelta(originalTimes, input.nowMs)
        : { pct24h: input.originalsToday > 0 ? null : 0, pct7d: 0 },
    postsToday: input.postsToday,
    postsTodayDelta:
      postTimes.length > 0
        ? countDelta(postTimes, input.nowMs)
        : { pct24h: input.postsToday > 0 ? null : 0, pct7d: 0 },
    dailyPostCap: input.dailyPostCap,
    paceRemainingMs: replyPaceRemainingMs(
      input.replyPaceUntil,
      input.nowMs,
    ),
    paceLocked: replyPaceLocked(input.replyPaceUntil, input.nowMs),
    postsBand: postsBand(input.postsToday, input.dailyPostCap),
    inboundBand: inboundBand(marks),
  };
}
