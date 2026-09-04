import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dailyPostCap,
  DESK_GAUGE_LABEL,
  formatPerHour,
  formatPctDelta,
  markFromHistory,
  pctDelta,
  RATE_WINDOW,
  readDeskInstruments,
  trailingPerHour,
  utcDayStartMs,
  type DeskInstrumentInput,
  type DeskInstrumentMark,
} from "./deskInstruments.ts";

const NOW = Date.parse("2026-08-19T12:59:00.000Z");
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function read(
  overrides: Partial<DeskInstrumentInput> = {},
) {
  return readDeskInstruments({
    nowMs: NOW,
    marks: [],
    postsToday: 0,
    originalsToday: 0,
    dailyPostCap: 5,
    replyPaceUntil: null,
    ...overrides,
  });
}

function marksAt(
  isoHour: string,
  count: number,
): DeskInstrumentMark[] {
  const hourStart = Date.parse(`${isoHour}:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => ({
    atMs: hourStart + (index + 1) * 60_000,
  }));
}

describe("dailyPostCap", () => {
  it("matches the server formula fixtures", () => {
    assert.equal(dailyPostCap({ level: 1, currentStreak: 0 }), 5);
    assert.equal(dailyPostCap({ level: 3, currentStreak: 0 }), 6);
    assert.equal(dailyPostCap({ level: 3, currentStreak: 3 }), 7);
    assert.equal(dailyPostCap({ level: 3, currentStreak: 7 }), 8);
    assert.equal(dailyPostCap({ level: 99, currentStreak: 30 }), 20);
  });

  it("uses the UTC calendar day start", () => {
    assert.equal(
      utcDayStartMs(Date.parse("2026-08-19T23:59:59.999Z")),
      Date.parse("2026-08-19T00:00:00.000Z"),
    );
  });
});

describe("trailingPerHour", () => {
  it("is zero with no marks", () => {
    assert.equal(trailingPerHour([], NOW), 0);
  });

  it("uses the span of the last 500, not a clock-hour count", () => {
    const times = Array.from({ length: 10 }, (_, index) => NOW - (9 - index) * HOUR_MS);
    assert.equal(trailingPerHour(times, NOW).toFixed(2), "1.11");
  });

  it("caps the window at 500", () => {
    const times = Array.from(
      { length: RATE_WINDOW + 40 },
      (_, index) => NOW - index * 60_000,
    );
    const got = trailingPerHour(times, NOW);
    assert.equal(got.toFixed(2), "60.12");
    assert.ok(got > 1 && got < 200);
  });

  it("floors a same-instant burst at one minute so the rate stays finite", () => {
    assert.equal(trailingPerHour([NOW, NOW], NOW), 120);
  });
});

describe("pctDelta / format", () => {
  it("returns null when the previous value is zero and current is not", () => {
    assert.equal(pctDelta(2, 0), null);
    assert.equal(pctDelta(0, 0), 0);
    assert.equal(pctDelta(1.5, 1), 50);
  });

  it("prints two decimals on the hour rate", () => {
    assert.equal(formatPerHour(1.374), "1.37");
    assert.equal(formatPerHour(0), "0.00");
  });

  it("prints a percent, one decimal under 10", () => {
    assert.equal(formatPctDelta(12.4), "12%");
    assert.equal(formatPctDelta(1.44), "1.4%");
    assert.equal(formatPctDelta(null), null);
  });
});

describe("readDeskInstruments", () => {
  it("returns empty gauges for an empty account", () => {
    const got = read({ postsToday: 4, originalsToday: 1, dailyPostCap: 5 });
    assert.equal(got.windowSize, 0);
    assert.equal(got.repliesPerHour, 0);
    assert.deepEqual(got.repliesPerHourDelta, { pct24h: 0, pct7d: 0 });
    assert.equal(got.repliesUtcDay, 0);
    assert.equal(got.originalsToday, 1);
    assert.equal(got.postsToday, 4);
    assert.equal(got.dailyPostCap, 5);
    assert.equal(got.paceLocked, false);
    assert.equal(got.postsBand, "cool");
    assert.equal(got.inboundBand, null);
  });

  it("uses the reply pace clock for its lock state", () => {
    const got = read({ replyPaceUntil: NOW + 30_000 });
    assert.equal(got.paceRemainingMs, 30_000);
    assert.equal(got.paceLocked, true);
  });

  it("always shows a decimal replies/hour, even with few marks", () => {
    const got = read({
      marks: Array.from({ length: 3 }, (_, index) => ({
        atMs: NOW - (2 - index) * 2 * HOUR_MS,
      })),
    });
    assert.equal(got.repliesUtcDay, 3);
    assert.equal(formatPerHour(got.repliesPerHour), "0.75");
  });

  it("prefers the server 500-window over the short desk feed", () => {
    const replyAtMs = Array.from(
      { length: 20 },
      (_, index) => NOW - index * HOUR_MS,
    );
    const got = read({
      marks: [{ atMs: NOW - 1_000 }],
      replyAtMs,
    });
    assert.equal(got.windowSize, 20);
    assert.equal(formatPerHour(got.repliesPerHour), "1.05");
  });

  it("compares the 500-window rate to 24h and 7d ago", () => {
    const replyAtMs = [
      ...Array.from({ length: 8 }, (_, index) => NOW - index * HOUR_MS),
      ...Array.from({ length: 4 }, (_, index) => NOW - 2 * DAY_MS - index * HOUR_MS),
      ...Array.from({ length: 6 }, (_, index) => NOW - 8 * DAY_MS - index * HOUR_MS),
    ];
    const got = read({ replyAtMs });
    assert.ok(got.repliesPerHour > 0);
    assert.ok(got.repliesPerHourDelta.pct24h !== 0);
    assert.ok(got.repliesPerHourDelta.pct7d !== null);
    assert.ok(got.repliesPerHourDelta.pct7d !== 0);
  });

  it("counts OG and posts windows for 24h / 7d arrows", () => {
    const got = read({
      originalsToday: 2,
      postsToday: 3,
      originalAtMs: [NOW - 1_000, NOW - DAY_MS - 1_000],
      postAtMs: [NOW - 1_000, NOW - 2_000, NOW - DAY_MS - 1_000],
    });
    assert.equal(got.originalsToday, 2);
    assert.equal(got.originalsTodayDelta.pct24h, 0);
    assert.equal(got.postsTodayDelta.pct24h, 100);
  });

  it("compares count gauges at the same point in the previous day", () => {
    const got = read({
      originalsToday: 1,
      originalAtMs: [NOW - 30 * 60_000, NOW - DAY_MS - 30 * 60_000],
    });
    assert.equal(got.originalsTodayDelta.pct24h, 0);
  });

  it("classifies inbound samples as cool, warm, hot, or hidden", () => {
    const inbound = (
      samples: Array<Pick<DeskInstrumentMark, "t24hViews" | "t24hLikes">>,
    ) =>
      read({
        marks: samples.map((sample, index) => ({
          atMs: NOW - index * 1_000,
          ...sample,
        })),
      }).inboundBand;

    assert.equal(
      inbound([
        { t24hViews: 1 },
        { t24hViews: 2 },
        { t24hViews: 3 },
      ]),
      "cool",
    );
    assert.equal(
      inbound([
        { t24hViews: 1 },
        { t24hViews: 0, t24hLikes: 0 },
        { t24hLikes: 2 },
      ]),
      "warm",
    );
    assert.equal(
      inbound([
        { t24hViews: 0, t24hLikes: 0 },
        { t24hViews: 0, t24hLikes: 0 },
        { t24hViews: 0, t24hLikes: 0 },
      ]),
      "hot",
    );
    assert.equal(
      inbound([{ t24hViews: 0 }, { t24hViews: 0 }, { t24hLikes: 0 }]),
      "hot",
    );
    assert.equal(
      inbound([
        { t24hViews: 0, t24hLikes: 0 },
        { t24hViews: 0, t24hLikes: 0 },
        {},
      ]),
      null,
    );
  });

  it("classifies posts below, at, and above the supplied cap", () => {
    assert.equal(read({ postsToday: 4 }).postsBand, "cool");
    assert.equal(read({ postsToday: 5 }).postsBand, "warm");
    assert.equal(read({ postsToday: 6 }).postsBand, "hot");
  });

  it("prefers postedAt over at for sorting and counts", () => {
    const got = read({
      marks: [
        {
          atMs: NOW - 2 * 60 * 60_000,
          postedAtMs: NOW - 30_000,
        },
        {
          atMs: NOW - 20_000,
          postedAtMs: NOW - 2 * 60 * 60_000,
        },
      ],
    });

    assert.equal(got.repliesUtcDay, 2);
    assert.ok(got.repliesPerHour > 0);
  });

  it("maps client history without importing desk types", () => {
    assert.deepEqual(
      markFromHistory({
        at: "2026-08-19T10:00:00.000Z",
        postedAt: "2026-08-19T10:01:00.000Z",
        stats: { t24h: { views: 8, likes: 2 } },
      }),
      {
        atMs: Date.parse("2026-08-19T10:00:00.000Z"),
        postedAtMs: Date.parse("2026-08-19T10:01:00.000Z"),
        t24hViews: 8,
        t24hLikes: 2,
      },
    );
  });

  it("locks the product wording", () => {
    assert.equal(DESK_GAUGE_LABEL, "desk gauge");
    assert.equal(RATE_WINDOW, 500);
  });

  it("still accepts the old hour fixture as a real rate", () => {
    const got = read({
      marks: [
        ...marksAt("2026-08-19T08", 4),
        ...marksAt("2026-08-19T09", 4),
        ...marksAt("2026-08-19T10", 4),
        ...marksAt("2026-08-19T12", 3),
      ],
    });
    assert.equal(got.repliesUtcDay, 15);
    assert.ok(Number(formatPerHour(got.repliesPerHour)) > 1);
  });
});
