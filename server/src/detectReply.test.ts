import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectOwnReplyToThread } from "./detectReply.ts";
import type { ThreadCard } from "./xSearch.ts";

function card(
  partial: Partial<ThreadCard> & Pick<ThreadCard, "id">,
): ThreadCard {
  return {
    author: "@me",
    text: "hello",
    url: `https://x.com/me/status/${partial.id}`,
    ...partial,
  };
}

describe("detectOwnReplyToThread", () => {
  it("returns the unique reply matching inReplyToId", async () => {
    const result = await detectOwnReplyToThread({
      threadId: "parent1",
      screenName: "@marginsystems",
      searchTimelinePages: async (opts) => {
        assert.match(opts.query, /from:marginsystems/);
        assert.match(opts.query, /within_time:24h/);
        assert.equal(opts.product, "Latest");
        assert.equal(opts.maxPages, 1);
        return {
          ok: true,
          threads: [
            card({ id: "other", inReplyToId: "zzz", text: "nope" }),
            card({
              id: "reply1",
              inReplyToId: "parent1",
              text: "happy to connect",
              createdAt: "2026-07-30T00:00:00.000Z",
            }),
          ],
          queryId: "q",
          bottomCursor: null,
          pages: 1,
        };
      },
    });
    assert.equal(result.ok, true);
    assert.ok(result.reply);
    assert.equal(result.reply.replyId, "reply1");
    assert.equal(result.reply.replyText, "happy to connect");
    assert.equal(
      result.reply.replyUrl,
      "https://x.com/me/status/reply1",
    );
  });

  it("returns none when no parent match", async () => {
    const result = await detectOwnReplyToThread({
      threadId: "parent1",
      screenName: "me",
      searchTimelinePages: async () => ({
        ok: true,
        threads: [card({ id: "a", inReplyToId: "other" })],
        queryId: "q",
        bottomCursor: null,
      }),
    });
    assert.deepEqual(result, { ok: true, reply: null, reason: "none" });
  });

  it("returns ambiguous when multiple parent matches", async () => {
    const result = await detectOwnReplyToThread({
      threadId: "parent1",
      screenName: "me",
      searchTimelinePages: async () => ({
        ok: true,
        threads: [
          card({ id: "a", inReplyToId: "parent1" }),
          card({ id: "b", inReplyToId: "parent1" }),
        ],
        queryId: "q",
        bottomCursor: null,
      }),
    });
    assert.deepEqual(result, {
      ok: true,
      reply: null,
      reason: "ambiguous",
    });
  });

  it("returns search_failed on search error", async () => {
    const result = await detectOwnReplyToThread({
      threadId: "parent1",
      screenName: "me",
      searchTimelinePages: async () => ({
        ok: false,
        status: 429,
        error: "rate_limited",
        message: "busy",
      }),
    });
    assert.deepEqual(result, {
      ok: true,
      reply: null,
      reason: "search_failed",
    });
  });

  it("returns search_failed for empty screen name", async () => {
    const result = await detectOwnReplyToThread({
      threadId: "parent1",
      screenName: "",
      searchTimelinePages: async () => {
        throw new Error("should not search");
      },
    });
    assert.deepEqual(result, {
      ok: true,
      reply: null,
      reason: "search_failed",
    });
  });
});
