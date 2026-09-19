import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_DAY_WINDOW,
  ACTIVITY_WEEK_WINDOW,
  activityKindFromOwnPost,
  bucketClassifiedPosts,
  bucketInteractions,
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
      originals: 0,
      quotes: 0,
      replies: 0,
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

  it("uses the shipped classified path for mark timestamps and kinds", () => {
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

  it("classifies mark-only top-level replies and quote cards correctly", () => {
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

describe("viewsLineAltitude", () => {
  it("holds last sampled views when marks exist but samples do not", () => {
    assert.deepEqual(
      viewsLineAltitude(
        { period: "2026-08-14", interactions: 2, originals: 0, quotes: 0, replies: 2, views: 0, withStats: 0 },
        400,
      ),
      { views: 400, held: true },
    );
  });

  it("drops to zero on a missed day", () => {
    assert.deepEqual(
      viewsLineAltitude(
        { period: "2026-08-14", interactions: 0, originals: 0, quotes: 0, replies: 0, views: 0, withStats: 0 },
        400,
      ),
      { views: 0, held: false },
    );
  });

  it("uses sampled views when present", () => {
    assert.deepEqual(
      viewsLineAltitude(
        { period: "2026-08-13", interactions: 1, originals: 0, quotes: 0, replies: 1, views: 80, withStats: 1 },
        400,
      ),
      { views: 80, held: false },
    );
  });
});

describe("pendingReplyIds / mergeLiveMetrics", () => {
  it("lists unscored reply ids and merges live views in memory", () => {
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
    assert.equal(merged[0]?.stats?.t1h?.views, 12);
    assert.equal(history[0]?.stats?.t1h, undefined);
    assert.equal(merged[1]?.stats?.t1h?.views, 9);
  });

  it("skips writing a synthetic snapshot when live has likes but no views", () => {
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
});

describe("classified flight-path posts", () => {
  const now = Date.parse("2026-08-04T15:00:00.000Z");

  it("keeps a persisted original as OG, including a re-quote stored that way", () => {
    assert.equal(activityKindFromOwnPost("original"), "original");
    assert.equal(activityKindFromOwnPost("quote"), "quote");
    assert.equal(activityKindFromOwnPost("reply"), "reply");
    assert.equal(activityKindFromOwnPost("repost"), null);
  });

  it("stacks originals, quotes, and replies and drops reposts", () => {
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

  it("drops reposts from own-post activity", () => {
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

  it("does not double-count a mark whose reply is already in own_posts", () => {
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
