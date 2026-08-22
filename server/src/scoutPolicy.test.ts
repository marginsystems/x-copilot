import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clampBucketSize,
  clampTargetCool,
  isCoolThread,
  withScoutSearchExclusions,
} from "./scoutPolicy.ts";
import { card } from "./scoutCollect.testHelpers.ts";

describe("isCoolThread", () => {
  it("accepts priority/consider with bait <= 45", () => {
    assert.equal(
      isCoolThread(card({ id: "1", engage: "priority", baitScore: 45 })),
      true,
    );
    assert.equal(
      isCoolThread(card({ id: "2", engage: "consider", baitScore: 0 })),
      true,
    );
  });

  it("rejects skips and high bait", () => {
    assert.equal(
      isCoolThread(card({ id: "1", engage: "skip", baitScore: 10 })),
      false,
    );
    assert.equal(
      isCoolThread(card({ id: "2", engage: "priority", baitScore: 46 })),
      false,
    );
  });

  it("falls back to thread.score when baitScore is undefined", () => {
    assert.equal(
      isCoolThread(card({ id: "3", engage: "consider", score: 30 })),
      true,
    );
    assert.equal(
      isCoolThread(card({ id: "4", engage: "consider", score: 50 })),
      false,
    );
  });

  it("rejects cool-skip threadKinds even with middling bait", () => {
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

  it("rejects promo_op / bad_context / promo_context flags even when engage is cool", () => {
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
});

describe("clampTargetCool / clampBucketSize", () => {
  it("clamps targetCool 1–20 with default 5", () => {
    assert.equal(clampTargetCool(undefined), 5);
    assert.equal(clampTargetCool(4), 4);
    assert.equal(clampTargetCool(20), 20);
    assert.equal(clampTargetCool(21), 20);
  });

  it("allows bucket sizes 5, 10, or 20 (default 20)", () => {
    assert.equal(clampBucketSize(undefined), 20);
    assert.equal(clampBucketSize(5), 5);
    assert.equal(clampBucketSize(10), 10);
    assert.equal(clampBucketSize(20), 20);
    assert.equal(clampBucketSize(7), 20);
  });
});

describe("withScoutSearchExclusions", () => {
  it("appends -is:retweet once", () => {
    assert.equal(withScoutSearchExclusions("shipping AI"), "shipping AI -is:retweet");
    assert.equal(
      withScoutSearchExclusions("shipping AI -is:retweet"),
      "shipping AI -is:retweet",
    );
    assert.equal(
      withScoutSearchExclusions("is:retweet AI"),
      "is:retweet AI -is:retweet",
    );
  });
});
