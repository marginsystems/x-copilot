import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearParentTweetCache,
  hydrateReplyParents,
} from "./tweetLookup.ts";
import type { ThreadCard } from "./xSearch.ts";

function replyCard(overrides: Partial<ThreadCard> = {}): ThreadCard {
  return {
    id: "900",
    author: "@asker",
    text: "How do you pick products?",
    url: "https://x.com/asker/status/900",
    inReplyToId: "800",
    isReply: true,
    ...overrides,
  };
}

describe("hydrateReplyParents", () => {
  beforeEach(() => {
    clearParentTweetCache();
  });

  it("fills opText for replies missing OP", async () => {
    const { threads, unhydratedReplyCount } = await hydrateReplyParents({
      threads: [replyCard()],
      delayMs: 0,
      fetchParent: async ({ tweetId }) => {
        assert.equal(tweetId, "800");
        return {
          author: "@hustler",
          text: "mysaas just crossed $632 revenue 100% profit",
        };
      },
    });
    assert.equal(unhydratedReplyCount, 0);
    assert.equal(threads[0]?.opAuthor, "@hustler");
    assert.equal(threads[0]?.opParentDerived, true);
    assert.match(threads[0]?.opText ?? "", /\$632/);
  });

  it("skips lookup when already parent-derived", async () => {
    let calls = 0;
    const { threads, unhydratedReplyCount } = await hydrateReplyParents({
      threads: [
        replyCard({
          opAuthor: "@already",
          opText: "already have OP",
          opParentDerived: true,
        }),
      ],
      delayMs: 0,
      fetchParent: async () => {
        calls += 1;
        return { author: "@x", text: "nope" };
      },
    });
    assert.equal(calls, 0);
    assert.equal(unhydratedReplyCount, 0);
    assert.equal(threads[0]?.opText, "already have OP");
  });

  it("hydrates quote-bearing replies from the reply parent", async () => {
    let calls = 0;
    const { threads, unhydratedReplyCount } = await hydrateReplyParents({
      threads: [
        replyCard({
          opAuthor: "@someoneelse",
          opText: "text of the quoted tweet",
        }),
      ],
      delayMs: 0,
      fetchParent: async () => {
        calls += 1;
        return { author: "@hustler", text: "mysaas just crossed $632 revenue" };
      },
    });
    assert.equal(calls, 1);
    assert.equal(unhydratedReplyCount, 0);
    assert.equal(threads[0]?.opAuthor, "@hustler");
    assert.equal(threads[0]?.opParentDerived, true);
  });

  it("soft-fails when parent lookup returns null", async () => {
    const { threads, unhydratedReplyCount } = await hydrateReplyParents({
      threads: [replyCard()],
      delayMs: 0,
      fetchParent: async () => null,
    });
    assert.equal(unhydratedReplyCount, 1);
    assert.equal(threads[0]?.opText, undefined);
    assert.equal(threads[0]?.text, "How do you pick products?");
  });

  it("fetches conversation root when nested (parent ≠ root)", async () => {
    const fetched: string[] = [];
    const { threads, unhydratedReplyCount } = await hydrateReplyParents({
      threads: [
        replyCard({
          id: "900",
          inReplyToId: "850",
          conversationId: "800",
        }),
      ],
      delayMs: 0,
      fetchParent: async ({ tweetId }) => {
        fetched.push(tweetId);
        return {
          author: "@bait_op",
          text: "why is Japan so behind in AI what actually happened?",
        };
      },
    });
    assert.deepEqual(fetched, ["800"]);
    assert.equal(unhydratedReplyCount, 0);
    assert.equal(threads[0]?.opAuthor, "@bait_op");
    assert.match(threads[0]?.opText ?? "", /Japan so behind/);
  });
});
