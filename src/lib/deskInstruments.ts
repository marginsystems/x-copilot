import {
  replyPaceLocked,
  replyPaceRemainingMs,
} from "./replyPace";

export const DESK_GAUGE_LABEL = "desk gauge";
export const HOUR_WALK = 2;
export const POST_DAILY_CAP_MIN = 5;
export const POST_DAILY_CAP_MAX = 20;

const MAX_WINDOW_SIZE = 512;
const MIN_HOUR_MARKS = 8;
const MIN_COMPLETED_HOURS_WITH_DATA = 3;
const INBOUND_SAMPLE_SIZE = 5;
const MIN_INBOUND_SAMPLES = 3;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export type DeskGaugeBand = "cool" | "warm" | "hot";

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
  postsToday: number;
  /** From dailyPostCap({ level, currentStreak }). */
  dailyPostCap: number;
  /** sessionStorage until from replyPace. */
  replyPaceUntil: number | null;
};

export type DeskInstruments = {
  windowSize: number;
  repliesLast60s: number;
  repliesLastHour: number;
  repliesUtcDay: number;
  postsToday: number;
  dailyPostCap: number;
  paceRemainingMs: number;
  paceLocked: boolean;
  minuteBand: DeskGaugeBand;
  hourBand: DeskGaugeBand | null;
  hourMedian: number | null;
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

function countInRange(
  marks: DeskInstrumentMark[],
  afterMs: number,
  throughMs: number,
): number {
  return marks.filter((mark) => {
    const time = markTime(mark);
    return time > afterMs && time <= throughMs;
  }).length;
}

function medianWithEmptyHours(
  positiveCounts: number[],
  totalHourCount: number,
): number {
  const sortedCounts = positiveCounts.sort((a, b) => a - b);
  const emptyHourCount = Math.max(
    0,
    totalHourCount - sortedCounts.length,
  );
  const valueAt = (index: number): number =>
    index < emptyHourCount ? 0 : sortedCounts[index - emptyHourCount];
  const middle = Math.floor(totalHourCount / 2);
  return totalHourCount % 2 === 0
    ? (valueAt(middle - 1) + valueAt(middle)) / 2
    : valueAt(middle);
}

function readHourBaseline(
  marks: DeskInstrumentMark[],
  nowMs: number,
): { median: number; completedHoursWithData: number } | null {
  if (marks.length < MIN_HOUR_MARKS) return null;

  const currentHourStart = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const completedHourCounts = new Map<number, number>();

  for (const mark of marks) {
    const time = markTime(mark);
    const hourStart = Math.floor(time / HOUR_MS) * HOUR_MS;
    if (hourStart >= currentHourStart) continue;
    completedHourCounts.set(
      hourStart,
      (completedHourCounts.get(hourStart) ?? 0) + 1,
    );
  }

  if (completedHourCounts.size < MIN_COMPLETED_HOURS_WITH_DATA) return null;

  const oldestHour = Math.min(...completedHourCounts.keys());
  const totalHourCount = Math.max(
    1,
    Math.floor((currentHourStart - oldestHour) / HOUR_MS),
  );
  return {
    median: medianWithEmptyHours(
      [...completedHourCounts.values()],
      totalHourCount,
    ),
    completedHoursWithData: completedHourCounts.size,
  };
}

function hourBand(
  lastHour: number,
  median: number,
): DeskGaugeBand {
  const hotAt = Math.max(median * 2, median + 2 * HOUR_WALK);
  if (lastHour <= median + HOUR_WALK) return "cool";
  if (lastHour < hotAt) return "warm";
  return "hot";
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

export function readDeskInstruments(
  input: DeskInstrumentInput,
): DeskInstruments {
  const marks = input.marks
    .filter((mark) => Number.isFinite(markTime(mark)))
    .sort((a, b) => markTime(b) - markTime(a))
    .slice(0, MAX_WINDOW_SIZE);
  const repliesLast60s = countInRange(
    marks,
    input.nowMs - MINUTE_MS,
    input.nowMs,
  );
  const repliesLastHour = countInRange(
    marks,
    input.nowMs - HOUR_MS,
    input.nowMs,
  );
  const currentHourStart = Math.floor(input.nowMs / HOUR_MS) * HOUR_MS;
  const repliesCurrentHour = countInRange(
    marks,
    currentHourStart,
    input.nowMs,
  );
  const dayStart = utcDayStartMs(input.nowMs);
  const repliesUtcDay = marks.filter(
    (mark) => markTime(mark) >= dayStart && markTime(mark) <= input.nowMs,
  ).length;
  const baseline = readHourBaseline(marks, input.nowMs);

  return {
    windowSize: marks.length,
    repliesLast60s,
    repliesLastHour,
    repliesUtcDay,
    postsToday: input.postsToday,
    dailyPostCap: input.dailyPostCap,
    paceRemainingMs: replyPaceRemainingMs(
      input.replyPaceUntil,
      input.nowMs,
    ),
    paceLocked: replyPaceLocked(input.replyPaceUntil, input.nowMs),
    minuteBand: repliesLast60s >= 2 ? "hot" : "cool",
    hourBand:
      baseline === null
        ? null
        : hourBand(repliesCurrentHour, baseline.median),
    hourMedian: baseline?.median ?? null,
    postsBand: postsBand(input.postsToday, input.dailyPostCap),
    inboundBand: inboundBand(marks),
  };
}
