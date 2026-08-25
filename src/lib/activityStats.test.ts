import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  activityChartTipDetail,
  formatCount,
  formatPeriodTip,
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
});
