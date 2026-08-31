import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dailyPostCap,
  DESK_GAUGE_LABEL,
  markFromHistory,
  readDeskInstruments,
  utcDayStartMs,
  type DeskInstrumentInput,
  type DeskInstrumentMark,
} from "./deskInstruments.ts";

const NOW = Date.parse("2026-08-19T12:59:00.000Z");

function read(
  overrides: Partial<DeskInstrumentInput> = {},
) {
  return readDeskInstruments({
    nowMs: NOW,
    marks: [],
    postsToday: 0,
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

function hourFixture(currentHourCount: number): DeskInstrumentMark[] {
  return [
    ...marksAt("2026-08-19T08", 4),
    ...marksAt("2026-08-19T09", 4),
    ...marksAt("2026-08-19T10", 4),
    ...marksAt("2026-08-19T12", currentHourCount),
  ];
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

describe("readDeskInstruments", () => {
  it("returns hidden history gauges for an empty account", () => {
    assert.deepEqual(read({ postsToday: 4, dailyPostCap: 5 }), {
      windowSize: 0,
      repliesLast60s: 0,
      repliesLastHour: 0,
      repliesUtcDay: 0,
      postsToday: 4,
      dailyPostCap: 5,
      paceRemainingMs: 0,
      paceLocked: false,
      minuteBand: "cool",
      hourBand: null,
      hourMedian: null,
      postsBand: "cool",
      inboundBand: null,
    });
  });

  it("makes two replies in 60 seconds hot, but one cool", () => {
    const one = read({ marks: [{ atMs: NOW - 1_000 }] });
    const two = read({
      marks: [{ atMs: NOW - 1_000 }, { atMs: NOW - 59_999 }],
    });

    assert.equal(one.repliesLast60s, 1);
    assert.equal(one.minuteBand, "cool");
    assert.equal(two.repliesLast60s, 2);
    assert.equal(two.minuteBand, "hot");
  });

  it("uses the reply pace clock for its lock state", () => {
    const got = read({ replyPaceUntil: NOW + 30_000 });

    assert.equal(got.paceRemainingMs, 30_000);
    assert.equal(got.paceLocked, true);
    assert.equal(got.minuteBand, "cool");
  });

  it("hides the hour band with fewer than eight marks", () => {
    const got = read({
      marks: Array.from({ length: 7 }, (_, index) => ({
        atMs: NOW - index * 1_000,
      })),
    });

    assert.equal(got.repliesLastHour, 7);
    assert.equal(got.hourMedian, null);
    assert.equal(got.hourBand, null);
  });

  it("walks from a usual four-reply hour to cool, warm, and hot", () => {
    const cool = read({ marks: hourFixture(6) });
    const warm = read({ marks: hourFixture(7) });
    const hot = read({ marks: hourFixture(8) });

    assert.equal(cool.hourMedian, 4);
    assert.equal(cool.repliesLastHour, 6);
    assert.equal(cool.hourBand, "cool");
    assert.equal(warm.hourMedian, 4);
    assert.equal(warm.hourBand, "warm");
    assert.equal(hot.hourMedian, 4);
    assert.equal(hot.hourBand, "hot");
  });

  it("includes empty completed hours in an account's baseline", () => {
    const got = read({
      marks: [
        ...marksAt("2026-08-19T05", 4),
        ...marksAt("2026-08-19T06", 4),
        ...marksAt("2026-08-19T07", 4),
        ...marksAt("2026-08-19T12", 3),
      ],
    });

    assert.equal(got.hourMedian, 0);
    assert.equal(got.hourBand, "warm");
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

    assert.equal(got.repliesLast60s, 1);
    assert.equal(got.repliesLastHour, 1);
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
  });
});
