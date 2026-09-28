import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Interaction } from "./interactionStore.ts";
import { toRetainedInteraction } from "./retainedInteraction.ts";

const base: Interaction = {
  threadId: "100",
  author: "@op",
  authorKey: "op",
  at: "2026-09-20T10:00:00.000Z",
  source: "manual",
  userId: "u1",
};

await describe("toRetainedInteraction", async () => {
  await it("keeps only the fields the desk reads and drops empty values", () => {
    assert.deepEqual(toRetainedInteraction({
      ...base,
      url: "https://x.com/op/status/100",
      summary: "summary",
      text: "text",
      replyId: "200",
      replyUrl: "https://x.com/me/status/200",
      postedAt: "2026-09-20T10:00:01.000Z",
      conversationId: "",
      inReplyToId: "100",
      stats: {
        t1h: { views: 1, sampledAt: base.at },
        t24h: { views: 30, likes: 2, replies: 1, sampledAt: base.at },
      },
      memorySyncFailed: true,
      pendingMarkAts: [base.at],
    }), {
      threadId: "100",
      at: base.at,
      replyId: "200",
      replyUrl: "https://x.com/me/status/200",
      postedAt: "2026-09-20T10:00:01.000Z",
      inReplyToId: "100",
      stats: { t24h: { views: 30, likes: 2 } },
    });
  });

  await it("keeps url only when its status id is not already a row id", () => {
    assert.equal(toRetainedInteraction({ ...base, url: "https://x.com/op/status/100" }).url, undefined);
    assert.equal(toRetainedInteraction({ ...base, conversationId: "90", url: "https://x.com/op/status/90" }).url, undefined);
    assert.equal(toRetainedInteraction({ ...base, url: "https://x.com/op/status/555" }).url, "https://x.com/op/status/555");
    assert.equal(toRetainedInteraction({ ...base, url: "https://example.com/post" }).url, "https://example.com/post");
  });

  await it("omits stats without t24h views or likes", () => {
    assert.deepEqual(toRetainedInteraction({ ...base, stats: { t1h: { views: 4, sampledAt: base.at } } }), {
      threadId: "100", at: base.at,
    });
    assert.deepEqual(toRetainedInteraction({ ...base, stats: { t24h: { replies: 4, sampledAt: base.at } } }), {
      threadId: "100", at: base.at,
    });
  });
});
