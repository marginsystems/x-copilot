import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyPostKind,
  crcResponseToken,
  parsePostCreateEvent,
  verifyWebhookSignature,
} from "./xActivity.ts";

describe("xActivity CRC / signature", () => {
  it("builds the sha256= CRC token", () => {
    const token = crcResponseToken("challenge", "secret");
    assert.match(token, /^sha256=/);
    assert.equal(token, crcResponseToken("challenge", "secret"));
    assert.notEqual(token, crcResponseToken("other", "secret"));
  });

  it("accepts a matching webhook signature", () => {
    const body = Buffer.from('{"ok":true}', "utf8");
    const header = crcResponseToken('{"ok":true}', "secret");
    // CRC helper hashes a string; signature hashes raw bytes of the same text.
    assert.equal(verifyWebhookSignature(body, header, "secret"), true);
    assert.equal(verifyWebhookSignature(body, header, "nope"), false);
  });
});

describe("parsePostCreateEvent", () => {
  it("reads a reply with t0 metrics", () => {
    const parsed = parsePostCreateEvent({
      data: {
        event_uuid: "evt-1",
        event_type: "post.create",
        filter: { user_id: "99" },
        payload: {
          id: "111",
          author_id: "99",
          text: "nice take",
          created_at: "2026-08-15T00:00:00.000Z",
          in_reply_to_tweet_id: "222",
          in_reply_to_user_id: "33",
          conversation_id: "222",
          public_metrics: {
            impression_count: 10,
            like_count: 2,
            reply_count: 1,
            retweet_count: 0,
            bookmark_count: 3,
          },
        },
      },
    });
    assert.ok(parsed);
    assert.equal(parsed?.kind, "reply");
    assert.equal(parsed?.inReplyToId, "222");
    assert.equal(parsed?.metrics.bookmarks, 3);
    assert.equal(parsed?.metrics.views, 10);
  });

  it("reads an original post", () => {
    const parsed = parsePostCreateEvent({
      data: {
        event_uuid: "evt-2",
        event_type: "post.create",
        filter: { user_id: "99" },
        payload: {
          id: "333",
          author_id: "99",
          text: "shipping",
          created_at: "2026-08-15T01:00:00.000Z",
          public_metrics: { impression_count: 4, like_count: 1 },
        },
      },
    });
    assert.equal(parsed?.kind, "original");
    assert.equal(parsed?.inReplyToId, null);
    assert.equal(parsed?.metrics.likes, 1);
  });

  it("reads a flat XAA v2 delivery with the post under data", () => {
    const parsed = parsePostCreateEvent({
      event_uuid: "evt-flat",
      event_type: "post.create",
      for_user_id: "99",
      data: {
        id: "444",
        author_id: "99",
        text: "flat shape",
        created_at: "2026-08-15T02:00:00.000Z",
        public_metrics: { impression_count: 7, like_count: 2 },
      },
    });
    assert.ok(parsed);
    assert.equal(parsed?.eventUuid, "evt-flat");
    assert.equal(parsed?.postId, "444");
    assert.equal(parsed?.xUserId, "99");
    assert.equal(parsed?.kind, "original");
    assert.equal(parsed?.metrics.views, 7);
  });

  it("ignores non-create events", () => {
    assert.equal(
      parsePostCreateEvent({
        data: { event_type: "post.delete", payload: { id: "1" } },
      }),
      null,
    );
  });
});

describe("classifyPostKind", () => {
  it("prefers repost then reply then quote", () => {
    assert.equal(
      classifyPostKind({ referenced_tweets: [{ type: "retweeted" }] }),
      "repost",
    );
    assert.equal(classifyPostKind({ in_reply_to_tweet_id: "1" }), "reply");
    assert.equal(
      classifyPostKind({ referenced_tweets: [{ type: "quoted" }] }),
      "quote",
    );
    assert.equal(classifyPostKind({}), "original");
  });
});
