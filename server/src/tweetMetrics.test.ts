import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTweetMetrics } from "./tweetLookup.ts";

const metricsFixture = {
  data: {
    tweetResult: {
      result: {
        __typename: "Tweet",
        rest_id: "999",
        views: { count: "12345" },
        legacy: {
          id_str: "999",
          full_text: "hello",
          favorite_count: 7,
          reply_count: 2,
          retweet_count: 3,
        },
        core: {
          user_results: {
            result: { legacy: { screen_name: "me" } },
          },
        },
      },
    },
  },
};

describe("parseTweetMetrics", () => {
  it("reads views and legacy engagement from TweetResultByRestId", () => {
    const m = parseTweetMetrics(metricsFixture);
    assert.ok(m);
    assert.equal(m.views, 12345);
    assert.equal(m.likes, 7);
    assert.equal(m.replies, 2);
    assert.equal(m.retweets, 3);
  });

  it("unwraps TweetWithVisibilityResults", () => {
    const m = parseTweetMetrics({
      data: {
        tweet_result: {
          result: {
            __typename: "TweetWithVisibilityResults",
            tweet: {
              rest_id: "1",
              views: { count: "10" },
              legacy: { favorite_count: 1, reply_count: 0, retweet_count: 0 },
            },
          },
        },
      },
    });
    assert.ok(m);
    assert.equal(m.views, 10);
    assert.equal(m.likes, 1);
  });

  it("returns null for garbage / empty", () => {
    assert.equal(parseTweetMetrics(null), null);
    assert.equal(parseTweetMetrics({ data: {} }), null);
    assert.equal(parseTweetMetrics({ foo: 1 }), null);
  });
});
