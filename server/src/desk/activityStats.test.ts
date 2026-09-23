import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_DAY_WINDOW,
  ACTIVITY_WEEK_WINDOW,
  activityKindFromOwnPost,
  bucketClassifiedPosts,
  bucketInteractions,
  applyLiveOwnPostViews,
  chartRefreshReplyIds,
  mergeClassifiedActivity,
  mergeLiveMetrics,
  parseActivityBucket,
  pendingReplyIds,
  utcWeekKey,
  viewsForInteraction,
  type ActivityBucket,
} from "./activityStats.ts";
import { viewsLineAltitude } from "../../../src/lib/activityStats.ts";
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

await describe("parseActivityBucket", async () => {
  await it("defaults to day", () => {
    assert.equal(parseActivityBucket(undefined), "day");
    assert.equal(parseActivityBucket("week"), "week");
    assert.equal(parseActivityBucket("nope"), "day");
  });
});

await describe("viewsForInteraction", async () => {
  await it("prefers t24h views over t1h", () => {
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

  await it("uses the stored 24h count even when the 1h and live counts are higher", () => {
    assert.equal(
      viewsForInteraction(
        ix({
          threadId: "4",
          at: "2026-09-21T10:00:00.000Z",
          stats: {
            t1h: { views: 3077, sampledAt: "2026-09-21T11:00:00.000Z" },
            t24h: { views: 3011, sampledAt: "2026-09-22T10:00:00.000Z" },
            live: { views: 6300, sampledAt: "2026-09-22T11:00:00.000Z" },
          },
        }),
      ),
      3011,
    );
  });

  await it("uses a live impression count above the 1h checkpoint while 24h is pending", () => {
    assert.equal(
      viewsForInteraction(
        ix({
          threadId: "5",
          at: "2026-09-22T01:00:00.000Z",
          stats: {
            t1h: { views: 3017, sampledAt: "2026-09-22T02:00:00.000Z" },
            live: { views: 6300, sampledAt: "2026-09-22T10:00:00.000Z" },
          },
        }),
      ),
      6300,
    );
  });
});

await describe("bucketInteractions", async () => {
  const now = Date.parse("2026-08-04T15:00:00.000Z");

  await it("emits a full day window with zeros", () => {
    const result = bucketInteractions([], { bucket: "day", now });
    assert.equal(result.bucket, "day");
    assert.equal(result.series.length, ACTIVITY_DAY_WINDOW);
    assert.equal(result.series[result.series.length - 1]?.period, "2026-08-04");
    assert.equal(result.series[0]?.period, "2026-07-08");
    assert.deepEqual(result.totals, {
      interactions: 0,
      originals: 0,
      quotes: 0,
      replies: 0,
      views: 0,
      withStats: 0,
    });
  });

  await it("emits a full week window", () => {
    const result = bucketInteractions([], { bucket: "week", now });
    assert.equal(result.series.length, ACTIVITY_WEEK_WINDOW);
    assert.equal(result.series[result.series.length - 1]?.period, utcWeekKey(now));
  });

  await it("counts marks without stats and prefers t24h views", () => {
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

  await it("falls back to postedAt when at is unparseable", () => {
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

  await it("plots a live view count on the reply day, above the 1h checkpoint", () => {
    const now = Date.parse("2026-09-22T10:09:00.000Z");
    const history = mergeLiveMetrics(
      [
        ix({
          threadId: "parent",
          at: "2026-09-22T01:09:00.000Z",
          postedAt: "2026-09-22T01:09:00.000Z",
          replyId: "reply",
          inReplyToId: "parent",
          stats: {
            t1h: { views: 3017, sampledAt: "2026-09-22T02:09:00.000Z" },
          },
        }),
      ],
      new Map([["reply", { views: 6300 }]]),
    );
    const result = bucketInteractions(history, { bucket: "day", now });
    assert.equal(
      result.series.find((point) => point.period === "2026-09-22")?.views,
      6300,
    );
    assert.equal(
      result.series.find((point) => point.period === "2026-09-21")?.views,
      0,
    );
  });

  await it("uses the shipped classified path for mark timestamps and kinds", () => {
    const result = bucketInteractions(
      [
        ix({
          threadId: "reply",
          at: "2026-08-03T23:00:00.000Z",
          postedAt: "2026-08-04T01:00:00.000Z",
          inReplyToId: "parent",
        }),
      ],
      { bucket: "day", now },
    );
    assert.equal(
      result.series.find((point) => point.period === "2026-08-04")?.replies,
      1,
    );
    assert.equal(
      result.series.find((point) => point.period === "2026-08-03")?.interactions,
      0,
    );
  });

  await it("classifies mark-only top-level replies and quote cards correctly", () => {
    const merged = mergeClassifiedActivity({
      ownPosts: [],
      history: [
        ix({
          threadId: "top-level",
          at: "2026-08-04T10:00:00.000Z",
          replyId: "reply",
        }),
        ix({
          threadId: "quote-card",
          at: "2026-08-04T11:00:00.000Z",
          replyId: "quote",
          inReplyToId: "quoted-post",
        }),
      ],
    });
    assert.equal(merged.find((post) => post.id === "reply")?.kind, "quote");
    assert.equal(merged.find((post) => post.id === "quote")?.kind, "reply");
  });
});

await describe("viewsLineAltitude", async () => {
  await it("holds last sampled views when marks exist but samples do not", () => {
    assert.deepEqual(
      viewsLineAltitude(
        { period: "2026-08-14", interactions: 2, originals: 0, quotes: 0, replies: 2, views: 0, withStats: 0 },
        400,
      ),
      { views: 400, held: true },
    );
  });

  await it("drops to zero on a missed day", () => {
    assert.deepEqual(
      viewsLineAltitude(
        { period: "2026-08-14", interactions: 0, originals: 0, quotes: 0, replies: 0, views: 0, withStats: 0 },
        400,
      ),
      { views: 0, held: false },
    );
  });

  await it("uses sampled views when present", () => {
    assert.deepEqual(
      viewsLineAltitude(
        { period: "2026-08-13", interactions: 1, originals: 0, quotes: 0, replies: 1, views: 80, withStats: 1 },
        400,
      ),
      { views: 80, held: false },
    );
  });
});

await describe("pendingReplyIds / mergeLiveMetrics", async () => {
  await it("lists unscored reply ids and merges live views in memory", () => {
    const history = [
      ix({
        threadId: "a",
        at: "2026-08-14T10:00:00.000Z",
        replyId: "r1",
      }),
      ix({
        threadId: "b",
        at: "2026-08-14T11:00:00.000Z",
        replyId: "r2",
        stats: { t1h: { views: 9, sampledAt: "2026-08-14T12:00:00.000Z" } },
      }),
    ];
    assert.deepEqual(pendingReplyIds(history, 10), ["r1"]);
    const merged = mergeLiveMetrics(
      history,
      new Map([["r1", { views: 12, likes: 1 }]]),
      "2026-08-14T12:30:00.000Z",
    );
    assert.equal(merged[0]?.stats?.live?.views, 12);
    assert.equal(merged[0]?.stats?.t1h, undefined);
    assert.equal(bucketInteractions(merged, { bucket: "day", now: Date.parse("2026-08-14T13:00:00Z") }).totals.withStats, 2);
    assert.equal(history[0]?.stats?.t1h, undefined);
    assert.equal(merged[1]?.stats?.t1h?.views, 9);
  });

  await it("skips writing a synthetic snapshot when live has likes but no views", () => {
    const history = [
      ix({
        threadId: "c",
        at: "2026-08-14T10:00:00.000Z",
        replyId: "r3",
      }),
    ];
    const merged = mergeLiveMetrics(
      history,
      new Map([["r3", { likes: 3 }]]),
      "2026-08-14T12:30:00.000Z",
    );
    assert.equal(merged[0]?.stats?.t1h, undefined);
  });

  await it("overlays a live count without replacing a stored 1h checkpoint", () => {
    const history = [
      ix({
        threadId: "oreva",
        at: "2026-09-22T01:00:00.000Z",
        replyId: "r-live",
        stats: { t1h: { views: 3017, sampledAt: "2026-09-22T02:00:00.000Z" } },
      }),
    ];
    const merged = mergeLiveMetrics(
      history,
      new Map([["r-live", { views: 6300, likes: 0 }]]),
      "2026-09-22T10:00:00.000Z",
    );
    assert.equal(merged[0]?.stats?.t1h?.views, 3017);
    assert.equal(merged[0]?.stats?.live?.views, 6300);
    assert.equal(viewsForInteraction(merged[0]!), 6300);
    assert.equal(history[0]?.stats?.live, undefined);
  });

  await it("refreshes newest replies that already have a checkpoint, then own posts", () => {
    const history = [
      ix({
        threadId: "new",
        at: "2026-09-22T01:00:00.000Z",
        replyId: "fresh",
        stats: { t1h: { views: 3017, sampledAt: "2026-09-22T02:00:00.000Z" } },
      }),
      ix({
        threadId: "old",
        at: "2026-09-01T01:00:00.000Z",
        replyId: "stale-missing",
      }),
    ];
    assert.deepEqual(
      chartRefreshReplyIds(
        history,
        [{ id: "og" }, { id: "fresh" }],
        2,
      ),
      ["fresh", "stale-missing"],
    );
    assert.deepEqual(
      chartRefreshReplyIds(history, [{ id: "og" }], 3),
      ["fresh", "stale-missing", "og"],
    );
  });
});

await describe("applyLiveOwnPostViews", async () => {
  await it("raises a checkpoint to the live count and leaves a lower live count alone", () => {
    const posts = applyLiveOwnPostViews(
      [
        {
          id: "r1",
          kind: "reply",
          postedAt: "2026-09-22T01:00:00.000Z",
          views: 3017,
          withStats: true,
        },
        {
          id: "r2",
          kind: "reply",
          postedAt: "2026-09-21T01:00:00.000Z",
          views: 8000,
          withStats: true,
        },
      ],
      new Map([
        ["r1", { views: 6300 }],
        ["r2", { views: 1000 }],
      ]),
    );
    assert.equal(posts[0]?.views, 6300);
    assert.equal(posts[1]?.views, 8000);
  });
});

await describe("classified flight-path posts", async () => {
  const now = Date.parse("2026-08-04T15:00:00.000Z");

  await it("keeps a persisted original as OG, including a re-quote stored that way", () => {
    assert.equal(activityKindFromOwnPost("original"), "original");
    assert.equal(activityKindFromOwnPost("quote"), "quote");
    assert.equal(activityKindFromOwnPost("reply"), "reply");
    assert.equal(activityKindFromOwnPost("repost"), null);
  });

  await it("stacks originals, quotes, and replies and drops reposts", () => {
    const result = bucketClassifiedPosts(
      [
        {
          id: "og",
          postedAt: "2026-08-04T10:00:00.000Z",
          kind: "original",
          views: 20,
          withStats: true,
        },
        {
          id: "qt",
          postedAt: "2026-08-04T11:00:00.000Z",
          kind: "quote",
          views: 5,
          withStats: true,
        },
        {
          id: "rp",
          postedAt: "2026-08-04T12:00:00.000Z",
          kind: "reply",
          views: 8,
          withStats: true,
        },
        {
          id: "old",
          postedAt: "2026-06-01T00:00:00.000Z",
          kind: "original",
          views: 999,
          withStats: true,
        },
      ],
      { bucket: "day", now },
    );
    const aug4 = result.series.find((p) => p.period === "2026-08-04");
    assert.ok(aug4);
    assert.equal(aug4.originals, 1);
    assert.equal(aug4.quotes, 1);
    assert.equal(aug4.replies, 1);
    assert.equal(aug4.interactions, 3);
    assert.equal(aug4.views, 33);
    assert.equal(result.totals.originals, 1);
    assert.equal(result.totals.quotes, 1);
    assert.equal(result.totals.replies, 1);
    assert.equal(result.totals.interactions, 3);
  });

  await it("drops reposts from own-post activity", () => {
    const merged = mergeClassifiedActivity({
      ownPosts: [
        {
          id: "repost",
          kind: "repost",
          postedAt: "2026-08-04T10:00:00.000Z",
          views: 12,
          withStats: true,
        },
      ],
      history: [],
    });

    assert.equal(merged.find((post) => post.id === "repost"), undefined);
  });

  await it("does not double-count a mark whose reply is already in own_posts", () => {
    const merged = mergeClassifiedActivity({
      ownPosts: [
        {
          id: "r1",
          kind: "reply",
          postedAt: "2026-08-04T10:00:00.000Z",
          views: 40,
          withStats: false,
        },
        {
          id: "og1",
          kind: "original",
          postedAt: "2026-08-04T09:00:00.000Z",
          views: 40,
          withStats: true,
        },
      ],
      history: [
        ix({
          threadId: "t1",
          at: "2026-08-04T10:05:00.000Z",
          replyId: "r1",
          inReplyToId: "parent",
          stats: {
            t1h: { views: 30, sampledAt: "2026-08-04T11:05:00.000Z" },
          },
        }),
        ix({
          threadId: "t2",
          at: "2026-08-04T11:00:00.000Z",
          replyId: "ghost",
          inReplyToId: "parent",
        }),
      ],
    });
    assert.equal(merged.length, 3);
    assert.equal(merged.find((p) => p.id === "r1")?.kind, "reply");
    assert.equal(merged.find((p) => p.id === "r1")?.views, 40);
    assert.equal(merged.find((p) => p.id === "r1")?.withStats, true);
    assert.equal(merged.find((p) => p.id === "og1")?.kind, "original");
    assert.equal(merged.find((p) => p.id === "ghost")?.kind, "reply");
  });
});

await describe("stored 24h views in the flight path", async () => {
  const postedAt = "2026-09-21T23:30:00.000Z";
  const sampledAt = "2026-09-22T23:30:00.000Z";
  const now = Date.parse(sampledAt);

  for (const snapshotSource of ["interaction", "own post"] as const) {
    await it(`uses the ${snapshotSource} 24h snapshot over the other ledger's higher pending count`, () => {
      const history = [ix({
        threadId: "parent",
        replyId: "reply",
        at: sampledAt,
        postedAt,
        stats: {
          t1h: { views: 3077, sampledAt },
          ...(snapshotSource === "interaction"
            ? { t24h: { views: 3011, sampledAt } }
            : {}),
        },
      })];
      const ownPosts = [{
        id: "reply",
        kind: "reply" as const,
        postedAt,
        views: snapshotSource === "own post" ? 3011 : 7000,
        t24hViews: snapshotSource === "own post" ? 3011 : null,
        withStats: true,
      }];
      assert.deepEqual(chartRefreshReplyIds(history, ownPosts), []);
      const live = new Map([["reply", { views: 9000 }]]);
      const rows = mergeLiveMetrics(history, live);
      const posts = applyLiveOwnPostViews(ownPosts, live);
      const result = bucketClassifiedPosts(
        mergeClassifiedActivity({ history: rows, ownPosts: posts }),
        { bucket: "day", now },
      );
      assert.equal(result.totals.interactions, 1);
      assert.equal(result.totals.views, 3011);
      assert.equal(result.series.find((p) => p.period === "2026-09-21")?.views, 3011);
      assert.equal(result.series.find((p) => p.period === "2026-09-22")?.views, 0);
      assert.equal(history[0]?.stats?.live, undefined);
      if (snapshotSource === "interaction") assert.equal(rows[0], history[0]);
      else assert.equal(posts[0], ownPosts[0]);
    });
  }

  await it("retains a stored snapshot on an unmatched reply and excludes posts outside the UTC window", () => {
    const history = [ix({
      threadId: "parent",
      replyId: "unmatched",
      at: sampledAt,
      postedAt,
      stats: { t24h: { views: 3011, sampledAt } },
    }), ix({
      threadId: "old-parent",
      replyId: "old-reply",
      at: sampledAt,
      postedAt: "2026-01-01T00:00:00.000Z",
      stats: { t24h: { views: 9999, sampledAt } },
    })];
    const result = bucketClassifiedPosts(
      mergeClassifiedActivity({ history, ownPosts: [] }),
      { bucket: "day", now },
    );
    assert.equal(result.totals.views, 3011);
    assert.equal(result.totals.interactions, 1);
  });

  await it("treats zero as a mature count and refreshes missing or invalid 24h views within the cap", () => {
    const history = [0, undefined, NaN].map((views, i) => ix({
      threadId: `parent-${i}`,
      replyId: `reply-${i}`,
      at: postedAt,
      stats: { t24h: { views, sampledAt } },
    }));
    assert.deepEqual(chartRefreshReplyIds(history, [], 1), ["reply-1"]);
    assert.deepEqual(chartRefreshReplyIds(history, [], 0), []);
    assert.deepEqual(chartRefreshReplyIds(history), ["reply-1", "reply-2"]);
    assert.equal(viewsForInteraction(mergeLiveMetrics(history, new Map([["reply-0", { views: 100 }]]))[0]!), 0);
  });
});
