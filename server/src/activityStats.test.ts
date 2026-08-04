import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_DAY_WINDOW,
  ACTIVITY_WEEK_WINDOW,
  bucketInteractions,
  parseActivityBucket,
  utcWeekKey,
  viewsForInteraction,
  type ActivityBucket,
} from "./activityStats.ts";
import type { Interaction } from "./interactionStore.ts";

function ix(
  partial: Partial<Interaction> & Pick<Interaction, "threadId" | "at">,
): Interaction {
  return {
    author: "@u",
    authorKey: "u",
    source: "manual",
    ...partial,
  };
}

describe("parseActivityBucket", () => {
  it("defaults to day", () => {
    assert.equal(parseActivityBucket(undefined), "day");
    assert.equal(parseActivityBucket("week"), "week");
    assert.equal(parseActivityBucket("nope"), "day");
  });
});

describe("viewsForInteraction", () => {
  it("prefers t24h views over t1h", () => {
    assert.equal(
      viewsForInteraction(
        ix({
          threadId: "1",
          at: "2026-08-01T12:00:00.000Z",
          stats: {
            t1h: { views: 10, sampledAt: "2026-08-01T13:00:00.000Z" },
            t24h: { views: 100, sampledAt: "2026-08-02T12:00:00.000Z" },
          },
        }),
      ),
      100,
    );
    assert.equal(
      viewsForInteraction(
        ix({
          threadId: "2",
          at: "2026-08-01T12:00:00.000Z",
          stats: {
            t1h: { views: 10, sampledAt: "2026-08-01T13:00:00.000Z" },
          },
        }),
      ),
      10,
    );
    assert.equal(
      viewsForInteraction(
        ix({ threadId: "3", at: "2026-08-01T12:00:00.000Z" }),
      ),
      0,
    );
  });
});

describe("bucketInteractions", () => {
  const now = Date.parse("2026-08-04T15:00:00.000Z");

  it("emits a full day window with zeros", () => {
    const result = bucketInteractions([], { bucket: "day", now });
    assert.equal(result.bucket, "day");
    assert.equal(result.series.length, ACTIVITY_DAY_WINDOW);
    assert.equal(result.series[result.series.length - 1]?.period, "2026-08-04");
    assert.equal(result.series[0]?.period, "2026-07-08");
    assert.deepEqual(result.totals, {
      interactions: 0,
      views: 0,
      withStats: 0,
    });
  });

  it("emits a full week window", () => {
    const result = bucketInteractions([], { bucket: "week", now });
    assert.equal(result.series.length, ACTIVITY_WEEK_WINDOW);
    assert.equal(result.series[result.series.length - 1]?.period, utcWeekKey(now));
  });

  it("counts marks without stats and prefers t24h views", () => {
    const history = [
      ix({
        threadId: "a",
        at: "2026-08-04T10:00:00.000Z",
        stats: {
          t1h: { views: 5, sampledAt: "2026-08-04T11:00:00.000Z" },
          t24h: { views: 50, sampledAt: "2026-08-05T10:00:00.000Z" },
        },
      }),
      ix({
        threadId: "b",
        at: "2026-08-04T11:00:00.000Z",
        // pending stats
      }),
      ix({
        threadId: "c",
        at: "2026-08-03T09:00:00.000Z",
        postedAt: "2026-08-03T08:00:00.000Z",
        stats: {
          t1h: { views: 7, sampledAt: "2026-08-03T10:00:00.000Z" },
        },
      }),
      // Outside 28-day window
      ix({
        threadId: "old",
        at: "2026-06-01T00:00:00.000Z",
        stats: { t24h: { views: 999, sampledAt: "2026-06-02T00:00:00.000Z" } },
      }),
    ];

    const result = bucketInteractions(history, { bucket: "day", now });
    const aug4 = result.series.find((p) => p.period === "2026-08-04");
    const aug3 = result.series.find((p) => p.period === "2026-08-03");
    assert.ok(aug4);
    assert.ok(aug3);
    assert.equal(aug4.interactions, 2);
    assert.equal(aug4.views, 50);
    assert.equal(aug4.withStats, 1);
    assert.equal(aug3.interactions, 1);
    assert.equal(aug3.views, 7);
    assert.equal(aug3.withStats, 1);
    assert.equal(result.totals.interactions, 3);
    assert.equal(result.totals.views, 57);
    assert.equal(result.totals.withStats, 2);
  });

  it("falls back to postedAt when at is unparseable", () => {
    const history = [
      ix({
        threadId: "p",
        at: "not-a-date",
        postedAt: "2026-08-04T01:00:00.000Z",
        stats: { t1h: { views: 3, sampledAt: "2026-08-04T02:00:00.000Z" } },
      }),
    ];
    const result = bucketInteractions(history, { bucket: "day" as ActivityBucket, now });
    const aug4 = result.series.find((p) => p.period === "2026-08-04");
    assert.equal(aug4?.interactions, 1);
    assert.equal(aug4?.views, 3);
  });
});
