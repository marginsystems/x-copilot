import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  activityChartTipDetail,
  formatCount,
  formatPeriodTip,
  parseActivityStats,
  postKindCounts,
  stackBarSegments,
} from "./activityStats.ts";

describe("formatPeriodTip", () => {
  it("writes a day as M/D", () => {
    assert.equal(formatPeriodTip("2026-08-11", "day"), "8/11");
  });

  it("writes a week as Week N", () => {
    assert.equal(formatPeriodTip("2026-W33", "week"), "Week 33");
  });
});

describe("formatCount", () => {
  it("keeps small numbers intact", () => {
    assert.equal(formatCount(12), "12");
  });

  it("compacts thousands", () => {
    assert.equal(formatCount(37410), "37k");
  });
});

describe("activityChartTipDetail", () => {
  it("names posts and views", () => {
    assert.equal(activityChartTipDetail(12, 4210, false), "12 posts · 4.2k views");
  });

  it("singularizes one post", () => {
    assert.equal(activityChartTipDetail(1, 80, false), "1 post · 80 views");
  });

  it("says views pending when the line is holding", () => {
    assert.equal(activityChartTipDetail(3, 0, true), "3 posts · views pending");
  });

  it("adds the original / quote / reply mix when present", () => {
    assert.equal(
      activityChartTipDetail(4, 80, false, {
        originals: 2,
        quotes: 1,
        replies: 1,
      }),
      "4 posts · 80 views · 2 OG · 1 quote · 1 reply",
    );
  });
});

describe("postKindCounts / stackBarSegments", () => {
  it("treats a legacy interactions-only point as replies", () => {
    assert.deepEqual(
      postKindCounts({
        interactions: 3,
        originals: 0,
        quotes: 0,
        replies: 0,
      }),
      { originals: 0, quotes: 0, replies: 3 },
    );
  });

  it("stacks originals at the baseline, then quotes, then replies", () => {
    const segs = stackBarSegments(
      { originals: 2, quotes: 1, replies: 1 },
      4,
      40,
    );
    assert.deepEqual(
      segs.map((s) => [s.key, s.count, s.height]),
      [
        ["original", 2, 20],
        ["quote", 1, 10],
        ["reply", 1, 10],
      ],
    );
  });
});

describe("parseActivityStats", () => {
  it("defaults missing kind fields on an old boot snapshot", () => {
    const parsed = parseActivityStats({
      bucket: "day",
      series: [{ period: "2026-08-04", interactions: 2, views: 9, withStats: 1 }],
      totals: { interactions: 2, views: 9, withStats: 1 },
    });
    assert.equal(parsed?.series[0]?.originals, 0);
    assert.equal(parsed?.series[0]?.quotes, 0);
    assert.equal(parsed?.series[0]?.replies, 0);
    assert.equal(parsed?.totals.originals, 0);
  });
});
