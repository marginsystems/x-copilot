import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clampBucketSize,
  clampTargetCool,
  isCoolThread,
  SCOUT_MIN_LIKES,
  withScoutSearchExclusions,
} from "./scoutPolicy.ts";
import { card } from "./scoutCollect.testHelpers.ts";

await describe("isCoolThread", async () => {
  await it("accepts priority/consider with bait <= 45", () => {
    assert.equal(
      isCoolThread(card({ id: "1", engage: "priority", baitScore: 45 })),
      true,
    );
    assert.equal(
      isCoolThread(card({ id: "2", engage: "consider", baitScore: 0 })),
      true,
    );
  });

  await it("rejects skips and high bait", () => {
    assert.equal(
      isCoolThread(card({ id: "1", engage: "skip", baitScore: 10 })),
      false,
    );
    assert.equal(
      isCoolThread(card({ id: "2", engage: "priority", baitScore: 46 })),
      false,
    );
  });

  await it("falls back to thread.score when baitScore is undefined", () => {
    assert.equal(
      isCoolThread(card({ id: "3", engage: "consider", score: 30 })),
      true,
    );
    assert.equal(
      isCoolThread(card({ id: "4", engage: "consider", score: 50 })),
      false,
    );
  });

  await it("rejects cool-skip threadKinds even with middling bait", () => {
    assert.equal(
      isCoolThread(
        card({
          id: "1",
          engage: "consider",
          baitScore: 20,
          threadKind: "hollow_ask",
        }),
      ),
      false,
    );
    assert.equal(
      isCoolThread(
        card({
          id: "2",
          engage: "priority",
          baitScore: 15,
          threadKind: "promo_context",
        }),
      ),
      false,
    );
    assert.equal(
      isCoolThread(
        card({
          id: "3",
          engage: "consider",
          baitScore: 20,
          threadKind: "timely_take",
        }),
      ),
      true,
    );
  });

  await it("rejects promo_op / bad_context / promo_context flags even when engage is cool", () => {
    assert.equal(
      isCoolThread(
        card({
          id: "1",
          engage: "consider",
          baitScore: 20,
          threadKind: "lived_answer",
          flags: ["genuine_question", "promo_op"],
        }),
      ),
      false,
    );
    assert.equal(
      isCoolThread(
        card({
          id: "2",
          engage: "priority",
          baitScore: 15,
          threadKind: "sharp_opinion",
          flags: ["bad_context"],
        }),
      ),
      false,
    );
    assert.equal(
      isCoolThread(
        card({
          id: "3",
          engage: "consider",
          baitScore: 20,
          threadKind: "fact_add",
          flags: ["promo_context"],
        }),
      ),
      false,
    );
    assert.equal(
      isCoolThread(
        card({
          id: "4",
          engage: "consider",
          baitScore: 20,
          threadKind: "fact_add",
          flags: ["genuine_question", "on_agenda"],
        }),
      ),
      true,
    );
  });

  await it("rejects off-agenda sharp_opinion even when bait is low", () => {
    assert.equal(
      isCoolThread(
        card({
          id: "off",
          engage: "priority",
          baitScore: 15,
          threadKind: "sharp_opinion",
          onAgenda: false,
        }),
      ),
      false,
    );
    assert.equal(
      isCoolThread(
        card({
          id: "on",
          engage: "priority",
          baitScore: 15,
          threadKind: "sharp_opinion",
          onAgenda: true,
        }),
      ),
      true,
    );
    assert.equal(
      isCoolThread(
        card({
          id: "shape-only",
          engage: "priority",
          baitScore: 15,
          threadKind: "sharp_opinion",
          onAgenda: false,
        }),
        { agendaSet: false },
      ),
      true,
    );
  });
});

await describe("clampTargetCool / clampBucketSize", async () => {
  await it("clamps targetCool 1–20 with default 5", () => {
    assert.equal(clampTargetCool(undefined), 5);
    assert.equal(clampTargetCool(4), 4);
    assert.equal(clampTargetCool(20), 20);
    assert.equal(clampTargetCool(21), 20);
  });

  await it("allows bucket sizes 5, 10, or 20 (default 20)", () => {
    assert.equal(clampBucketSize(undefined), 20);
    assert.equal(clampBucketSize(5), 5);
    assert.equal(clampBucketSize(10), 10);
    assert.equal(clampBucketSize(20), 20);
    assert.equal(clampBucketSize(7), 20);
  });
});

const NO_X_FILTERS = {
  dropNativeMedia: false,
  dropHashtags: false,
  dropArticles: false,
  filterByMinViews: false,
};

await describe("withScoutSearchExclusions", async () => {
  await it("appends -is:retweet and -is:reply once", () => {
    assert.equal(
      withScoutSearchExclusions("shipping AI", NO_X_FILTERS),
      "shipping AI -is:retweet -is:reply",
    );
    assert.equal(
      withScoutSearchExclusions("shipping AI -is:retweet", NO_X_FILTERS),
      "shipping AI -is:retweet -is:reply",
    );
    assert.equal(
      withScoutSearchExclusions("is:reply AI", NO_X_FILTERS),
      "AI -is:retweet -is:reply",
    );
  });

  await it("filters media, hashtags, and low likes on X by default so rejected posts are never billed", () => {
    const expected = `shipping AI -is:retweet -is:reply -has:media -has:hashtags -url:"x.com/i/article" min_likes:${SCOUT_MIN_LIKES}`;
    assert.equal(withScoutSearchExclusions("shipping AI"), expected);
    assert.equal(withScoutSearchExclusions("shipping AI", {}), expected);
  });

  await it("leaves each X-side filter off when its Scout setting is off", () => {
    assert.equal(
      withScoutSearchExclusions("shipping AI", { dropNativeMedia: false }),
      `shipping AI -is:retweet -is:reply -has:hashtags -url:"x.com/i/article" min_likes:${SCOUT_MIN_LIKES}`,
    );
    assert.equal(
      withScoutSearchExclusions("shipping AI", { dropHashtags: false }),
      `shipping AI -is:retweet -is:reply -has:media -url:"x.com/i/article" min_likes:${SCOUT_MIN_LIKES}`,
    );
    assert.equal(
      withScoutSearchExclusions("shipping AI", { filterByMinViews: false }),
      'shipping AI -is:retweet -is:reply -has:media -has:hashtags -url:"x.com/i/article"',
    );
  });

  await it("excludes X Articles on X's side unless dropArticles is off", () => {
    assert.equal(
      withScoutSearchExclusions("shipping AI", {
        ...NO_X_FILTERS,
        dropArticles: undefined,
      }),
      'shipping AI -is:retweet -is:reply -url:"x.com/i/article"',
    );
    assert.equal(
      withScoutSearchExclusions("shipping AI", { dropArticles: false }),
      `shipping AI -is:retweet -is:reply -has:media -has:hashtags min_likes:${SCOUT_MIN_LIKES}`,
    );
  });

  await it("does not repeat an article exclusion the query already has", () => {
    assert.equal(
      withScoutSearchExclusions('launch -URL:"x.com/i/article"', {
        ...NO_X_FILTERS,
        dropArticles: undefined,
      }),
      'launch -URL:"x.com/i/article" -is:retweet -is:reply',
    );
  });

  await it("keeps the article exclusion outside the OR group", () => {
    assert.equal(
      withScoutSearchExclusions("freight OR logistics", {
        ...NO_X_FILTERS,
        dropArticles: undefined,
      }),
      '(freight OR logistics) -is:retweet -is:reply -url:"x.com/i/article"',
    );
    assert.equal(
      withScoutSearchExclusions(
        'freight OR logistics -url:"x.com/i/article" min_likes:20',
        { ...NO_X_FILTERS, dropArticles: undefined },
      ),
      '(freight OR logistics) -url:"x.com/i/article" min_likes:20 -is:retweet -is:reply',
    );
  });

  await it("keeps a planner-chosen like floor and does not repeat operators", () => {
    assert.equal(
      withScoutSearchExclusions("launch min_likes:20 -has:media"),
      'launch min_likes:20 -has:media -is:retweet -is:reply -has:hashtags -url:"x.com/i/article"',
    );
  });

  await it("rewrites min_faves, which the X API rejects with a 400, to min_likes", () => {
    assert.equal(
      withScoutSearchExclusions("launch min_faves:10", NO_X_FILTERS),
      "launch min_likes:10 -is:retweet -is:reply",
    );
    assert.equal(
      withScoutSearchExclusions("launch min_faves:10"),
      'launch min_likes:10 -is:retweet -is:reply -has:media -has:hashtags -url:"x.com/i/article"',
    );
  });

  await it("groups OR queries so every exclusion applies to each branch", () => {
    assert.equal(
      withScoutSearchExclusions("freight OR logistics", NO_X_FILTERS),
      "(freight OR logistics) -is:retweet -is:reply",
    );
    assert.equal(
      withScoutSearchExclusions("oregon ORbit", NO_X_FILTERS),
      "oregon ORbit -is:retweet -is:reply",
    );
  });

  await it("applies existing like and content filters to every OR branch", () => {
    assert.equal(
      withScoutSearchExclusions("freight OR logistics min_likes:20 -has:media"),
      '(freight OR logistics) min_likes:20 -has:media -is:retweet -is:reply -has:hashtags -url:"x.com/i/article"',
    );
  });

  await it("does not append a second floor after a negated like operator", () => {
    assert.equal(
      withScoutSearchExclusions("launch -min_faves:10"),
      'launch -min_likes:10 -is:retweet -is:reply -has:media -has:hashtags -url:"x.com/i/article"',
    );
  });

  await it("skips the like floor when the view floor is zero", () => {
    assert.equal(
      withScoutSearchExclusions("shipping AI", { minViews: 0 }),
      'shipping AI -is:retweet -is:reply -has:media -has:hashtags -url:"x.com/i/article"',
    );
  });

  await it("does not turn an operator-only query into a catch-all search", () => {
    assert.equal(withScoutSearchExclusions("is:reply"), "-is:retweet -is:reply");
  });
});
