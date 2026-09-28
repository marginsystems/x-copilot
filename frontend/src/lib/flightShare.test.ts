import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivityStats } from "./activityStats.ts";
import { emptyGamificationStats } from "./gamification.ts";
import {
  altitudeSeries,
  chartBarLayout,
  chartLabelIndices,
  drawFlightShareImage,
  flightShareLayout,
  formatShareCount,
  shareAxisLabel,
  flightShareCaption,
  flightShareFilename,
  flightShareIntentUrl,
  flightSharePayload,
  FLIGHT_SHARE_DISCLAIMER,
  FLIGHT_SHARE_HEIGHT,
  FLIGHT_SHARE_SITE,
  FLIGHT_SHARE_WIDTH,
} from "./flightShare.ts";

const week: ActivityStats = {
  bucket: "week",
  series: [
    { period: "2026-W32", interactions: 2, originals: 1, quotes: 0, replies: 1, views: 40, withStats: 1 },
    { period: "2026-W33", interactions: 3, originals: 0, quotes: 1, replies: 2, views: 0, withStats: 0 },
    { period: "2026-W34", interactions: 0, originals: 0, quotes: 0, replies: 0, views: 0, withStats: 0 },
  ],
  totals: { interactions: 5, originals: 1, quotes: 1, replies: 3, views: 40, withStats: 1 },
};

await describe("flightSharePayload", () => {
  it("returns null without marks", () => {
    assert.equal(
      flightSharePayload(
        { bucket: "week", series: [], totals: { interactions: 0, originals: 0, quotes: 0, replies: 0, views: 0, withStats: 0 } },
        emptyGamificationStats(),
      ),
      null,
    );
    assert.equal(flightSharePayload(null, emptyGamificationStats()), null);
  }).catch(assert.fail);

  it("keeps streak, level, and a next goal when present", () => {
    const payload = flightSharePayload(week, {
      ...emptyGamificationStats(),
      currentStreak: 4,
      longestStreak: 7,
      level: 3,
      lifetimeXp: 40,
      nextGoal: {
        id: "marks-10",
        kind: "marks",
        title: "Ten marks",
        detail: "6 to go",
        remaining: 6,
      },
    });
    assert.equal(payload?.bucket, "week");
    assert.equal(payload?.marked, 5);
    assert.equal(payload?.streak, 4);
    assert.equal(payload?.level, 3);
    assert.equal(payload?.nextGoal, "Ten marks — 6 to go");
    assert.equal(payload?.altitude[1]?.held, true);
    assert.equal(payload?.altitude[1]?.views, 40);
  }).catch(assert.fail);

});

await describe("altitudeSeries", () => {
  it("holds last sampled views on a marked day with no sample", () => {
    const alt = altitudeSeries(week.series);
    assert.deepEqual(
      alt.map((p) => [p.period, p.views, p.held]),
      [
        ["2026-W32", 40, false],
        ["2026-W33", 40, true],
        ["2026-W34", 0, false],
      ],
    );
  }).catch(assert.fail);

});

await describe("flightShareFilename and caption", () => {
  it("names the file after the bucket and writes a post caption", () => {
    const payload = flightSharePayload(week, {
      ...emptyGamificationStats(),
      currentStreak: 4,
      level: 3,
    })!;
    assert.equal(flightShareFilename(payload), "xcopilot-flight-week.png");
    assert.equal(
      flightShareFilename({ ...payload, bucket: "day" }),
      "xcopilot-flight-day.png",
    );
    const caption = flightShareCaption(payload);
    assert.match(caption, /This week's flight path/);
    assert.match(caption, /5 posts/);
    assert.match(caption, /Lv 3/);
    assert.match(caption, /streak 4/);
    assert.match(caption, new RegExp(FLIGHT_SHARE_SITE));
    assert.match(caption, /Not affiliated with X Corp/);
    assert.doesNotMatch(caption, /remaining/);
    const intent = flightShareIntentUrl(payload);
    assert.match(intent, /^https:\/\/x\.com\/intent\/tweet\?/);
    assert.match(intent, /text=/);
    assert.match(intent, /xcopilot/);
  }).catch(assert.fail);

});

await describe("drawFlightShareImage", () => {
  function recordCtx() {
    const texts: string[] = [];
    const ctx = {
      fillStyle: "",
      strokeStyle: "",
      font: "",
      textBaseline: "top" as CanvasTextBaseline,
      textAlign: "left" as CanvasTextAlign,
      lineWidth: 1,
      lineJoin: "round" as CanvasLineJoin,
      lineCap: "round" as CanvasLineCap,
      fillRect() {},
      beginPath() {},
      closePath() {},
      fill() {},
      stroke() {},
      moveTo() {},
      lineTo() {},
      roundRect() {},
      rect() {},
      fillText(text: string) {
        texts.push(text);
      },
      measureText(text: string) {
        return { width: String(text).length * 8 };
      },
      createLinearGradient() {
        return { addColorStop() {} };
      },
    };
    return { ctx, texts };
  }

  it("paints totals, the watermark, and does not invent a goal", () => {
    const { ctx, texts } = recordCtx();
    drawFlightShareImage(
      ctx,
      flightSharePayload(week, {
        ...emptyGamificationStats(),
        currentStreak: 4,
        longestStreak: 9,
        level: 3,
      })!,
    );
    const joined = texts.join("\n");
    assert.match(joined, /THIS WEEK/);
    assert.ok(texts.includes("5"));
    assert.ok(texts.includes("3"));
    assert.match(joined, /LEVEL/);
    assert.match(joined, /DAY STREAK · BEST 9/);
    assert.match(joined, /W32/);
    assert.match(joined, new RegExp(FLIGHT_SHARE_SITE));
    assert.match(joined, new RegExp(FLIGHT_SHARE_DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(joined, /NEXT/);
  }).catch(assert.fail);

  it("paints the next goal when one exists", () => {
    const { ctx, texts } = recordCtx();
    drawFlightShareImage(ctx, {
      ...flightSharePayload(week, emptyGamificationStats())!,
      nextGoal: "Level 37 — 52 XP to go",
    });
    assert.ok(texts.includes("NEXT"));
    assert.ok(texts.includes("Level 37 — 52 XP to go"));
  }).catch(assert.fail);
});

await describe("FLIGHT_SHARE_DISCLAIMER", () => {
  it("reads as one sentence per clause without a doubled period", () => {
    assert.equal(
      FLIGHT_SHARE_DISCLAIMER,
      "Built by Mergestorm, Inc. Not affiliated with X Corp.",
    );
  }).catch(assert.fail);
});

await describe("flightShareLayout", () => {
  for (const hasGoal of [true, false]) {
    it(`stacks sections without overlap or dead space (goal: ${hasGoal})`, () => {
      const L = flightShareLayout(FLIGHT_SHARE_WIDTH, FLIGHT_SHARE_HEIGHT, hasGoal);
      assert.equal(L.padX * 2 + L.contentW, FLIGHT_SHARE_WIDTH);
      assert.equal(L.titleY, FLIGHT_SHARE_HEIGHT - L.bottom);
      assert.ok(L.titleY < L.kickerY && L.kickerY < L.ruleY);
      assert.ok(L.ruleY < L.statValueY && L.statValueY < L.statLabelY);
      assert.ok(L.statLabelY < L.chart.y);
      assert.equal(L.chart.x, L.padX);
      assert.equal(L.chart.w, L.contentW);
      assert.equal(L.statColW * 4, L.contentW);
      const chartBottom = L.chart.y + L.chart.h;
      const gapAboveChart = L.chart.y - (L.statLabelY + 22);
      if (hasGoal) {
        assert.ok(L.goalY !== null);
        assert.equal(L.goalY - chartBottom, gapAboveChart);
        assert.ok(L.goalY + 64 <= L.footerTop);
      } else {
        assert.equal(L.goalY, null);
        assert.equal(L.footerTop - chartBottom, gapAboveChart);
      }
      assert.ok(L.chart.h > FLIGHT_SHARE_HEIGHT * 0.45);
      assert.ok(L.footerTextY < L.bottom);
    }).catch(assert.fail);
  }

  it("gives the chart the goal's space when there is no goal", () => {
    const withGoal = flightShareLayout(FLIGHT_SHARE_WIDTH, FLIGHT_SHARE_HEIGHT, true);
    const without = flightShareLayout(FLIGHT_SHARE_WIDTH, FLIGHT_SHARE_HEIGHT, false);
    assert.equal(without.chart.y, withGoal.chart.y);
    assert.ok(without.chart.h > withGoal.chart.h);
    assert.equal(without.footerTop, withGoal.footerTop);
  }).catch(assert.fail);
});

await describe("chartBarLayout", () => {
  for (const n of [1, 3, 8, 14, 28, 31]) {
    it(`keeps ${n} bars equal width with equal gaps inside the plot`, () => {
      const innerW = 848;
      const { slot, barW, offset } = chartBarLayout(innerW, n);
      assert.ok(Number.isInteger(slot) && Number.isInteger(barW));
      assert.ok(barW >= 1 && barW <= 72 && barW <= slot);
      assert.ok(offset >= 0);
      assert.ok(offset + (n - 1) * slot + barW <= innerW);
      const left = offset;
      const right = innerW - (offset + (n - 1) * slot + barW);
      assert.ok(Math.abs(left - right) <= 1);
    }).catch(assert.fail);
  }

  it("leaves a visible gap between 28 daily bars", () => {
    const { slot, barW } = chartBarLayout(848, 28);
    assert.ok(slot - barW >= 8);
  }).catch(assert.fail);
});

await describe("chartLabelIndices", () => {
  it("labels every week when there are few points", () => {
    assert.deepEqual(chartLabelIndices(8), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(chartLabelIndices(0), []);
  }).catch(assert.fail);

  it("labels 28 days weekly and always the last day", () => {
    assert.deepEqual(chartLabelIndices(28), [0, 7, 14, 21, 27]);
  }).catch(assert.fail);

  it("drops a label that would crowd the last one", () => {
    assert.deepEqual(chartLabelIndices(14), [0, 4, 8, 13]);
    for (const n of [9, 20, 28, 31, 60]) {
      const idx = chartLabelIndices(n);
      assert.ok(idx.length <= 5);
      assert.equal(idx[0], 0);
      assert.equal(idx[idx.length - 1], n - 1);
    }
  }).catch(assert.fail);
});

await describe("shareAxisLabel and formatShareCount", () => {
  it("writes readable axis dates", () => {
    assert.equal(shareAxisLabel("2026-09-01", "day"), "Sep 1");
    assert.equal(shareAxisLabel("2026-12-28", "day"), "Dec 28");
    assert.equal(shareAxisLabel("2026-W33", "week"), "W33");
    assert.equal(shareAxisLabel("bogus", "day"), "bogus");
  }).catch(assert.fail);

  it("keeps big numbers short enough for a stat column", () => {
    assert.equal(formatShareCount(108), "108");
    assert.equal(formatShareCount(9_999), "9,999");
    assert.equal(formatShareCount(12_046), "12K");
    assert.equal(formatShareCount(12_873), "12.9K");
    assert.equal(formatShareCount(48_213_904), "48.2M");
    assert.equal(formatShareCount(-3), "0");
    assert.equal(formatShareCount(Number.NaN), "0");
  }).catch(assert.fail);
});
