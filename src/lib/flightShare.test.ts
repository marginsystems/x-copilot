import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivityStats } from "./activityStats.ts";
import { emptyGamificationStats } from "./gamification.ts";
import {
  altitudeSeries,
  drawFlightShareImage,
  flightShareCaption,
  flightShareFilename,
  flightShareIntentUrl,
  flightSharePayload,
  FLIGHT_SHARE_DISCLAIMER,
  FLIGHT_SHARE_SITE,
} from "./flightShare.ts";

const week: ActivityStats = {
  bucket: "week",
  series: [
    { period: "2026-W32", interactions: 2, views: 40, withStats: 1 },
    { period: "2026-W33", interactions: 3, views: 0, withStats: 0 },
    { period: "2026-W34", interactions: 0, views: 0, withStats: 0 },
  ],
  totals: { interactions: 5, views: 40, withStats: 1 },
};

describe("flightSharePayload", () => {
  it("returns null without marks", () => {
    assert.equal(
      flightSharePayload(
        { bucket: "week", series: [], totals: { interactions: 0, views: 0, withStats: 0 } },
        emptyGamificationStats(),
      ),
      null,
    );
    assert.equal(flightSharePayload(null, emptyGamificationStats()), null);
  });

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
  });
});

describe("altitudeSeries", () => {
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
  });
});

describe("flightShareFilename and caption", () => {
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
    assert.match(caption, /5 marked/);
    assert.match(caption, /Lv 3/);
    assert.match(caption, /streak 4/);
    assert.match(caption, new RegExp(FLIGHT_SHARE_SITE));
    assert.match(caption, /Not affiliated with X Corp/);
    assert.doesNotMatch(caption, /remaining/);
    const intent = flightShareIntentUrl(payload);
    assert.match(intent, /^https:\/\/x\.com\/intent\/tweet\?/);
    assert.match(intent, /text=/);
    assert.match(intent, /xcopilot/);
  });
});

describe("drawFlightShareImage", () => {
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
        level: 3,
      })!,
    );
    const joined = texts.join("\n");
    assert.match(joined, /THIS WEEK/);
    assert.match(joined, /5/);
    assert.match(joined, /Lv 3/);
    assert.match(joined, /streak 4/);
    assert.match(joined, new RegExp(FLIGHT_SHARE_SITE));
    assert.match(joined, new RegExp(FLIGHT_SHARE_DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(joined, /NEXT/);
  });
});
