import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearParentTweetCache,
  fetchParentTweet,
  hydrateReplyParents,
  parseTweetsMetricsMap,
} from "./tweetLookup.ts";
import type { ThreadCard } from "./threadCard.ts";

function withSession(fn: () => Promise<void>): Promise<void> {
  const prev = process.env.X_API_BEARER_TOKEN;
  process.env.X_API_BEARER_TOKEN = "test-bearer";
  return fn().finally(() => {
    if (prev === undefined) delete process.env.X_API_BEARER_TOKEN;
    else process.env.X_API_BEARER_TOKEN = prev;
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () =>
      typeof body === "string" ? body : JSON.stringify(body),
  } as Response;
}

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
    assert.equal(
      threads[0]?.opCharCount,
      "mysaas just crossed $632 revenue 100% profit".length,
    );
  });

  it("copies parent longform and full char count onto the reply", async () => {
    const { threads, unhydratedReplyCount } = await hydrateReplyParents({
      threads: [replyCard()],
      delayMs: 0,
      fetchParent: async () => ({
        author: "@writer",
        text: "y".repeat(800),
        longform: "article",
      }),
    });
    assert.equal(unhydratedReplyCount, 0);
    assert.equal(threads[0]?.opLongform, "article");
    assert.equal(threads[0]?.opCharCount, 800);
    assert.equal(threads[0]?.opText?.length, 500);
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

  it("prefers conversation root when nested (parent ≠ root)", async () => {
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
        if (tweetId === "800") {
          return {
            author: "@bait_op",
            text: "why is Japan so behind in AI what actually happened?",
          };
        }
        return { author: "@middler", text: "middle of the thread" };
      },
    });
    assert.deepEqual(fetched, ["850", "800"]);
    assert.equal(unhydratedReplyCount, 0);
    assert.equal(threads[0]?.opAuthor, "@bait_op");
    assert.match(threads[0]?.opText ?? "", /Japan so behind/);
  });

  it("falls back to the immediate parent when the conversation root is unavailable", async () => {
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
        if (tweetId === "800") return null;
        return { author: "@middler", text: "middle of the thread" };
      },
    });
    assert.deepEqual(fetched, ["850", "800"]);
    assert.equal(unhydratedReplyCount, 0);
    assert.equal(threads[0]?.opAuthor, "@middler");
    assert.equal(threads[0]?.opParentDerived, true);
  });

  it("marks nested self-replies via the immediate parent (root author differs)", async () => {
    const fetched: string[] = [];
    const { threads, unhydratedReplyCount } = await hydrateReplyParents({
      threads: [
        replyCard({
          id: "900",
          inReplyToId: "880",
          conversationId: "800",
        }),
      ],
      delayMs: 0,
      fetchParent: async ({ tweetId }) => {
        fetched.push(tweetId);
        if (tweetId === "880") {
          return { author: "@asker", text: "my own earlier reply" };
        }
        return { author: "@bait_op", text: "bait root" };
      },
    });
    assert.deepEqual(fetched, ["880"]);
    assert.equal(unhydratedReplyCount, 0);
    assert.equal(threads[0]?.opAuthor, "@asker");
    assert.equal(threads[0]?.opParentDerived, true);
  });

  it("keeps the immediate parent when the root is the card author's own thread", async () => {
    const fetched: string[] = [];
    const { threads, unhydratedReplyCount } = await hydrateReplyParents({
      threads: [
        replyCard({
          id: "900",
          author: "@asker",
          inReplyToId: "850",
          conversationId: "800",
        }),
      ],
      delayMs: 0,
      fetchParent: async ({ tweetId }) => {
        fetched.push(tweetId);
        if (tweetId === "850") {
          return { author: "@bob", text: "bob's reply" };
        }
        return { author: "@asker", text: "bait root" };
      },
    });
    assert.deepEqual(fetched, ["850", "800"]);
    assert.equal(unhydratedReplyCount, 0);
    assert.equal(threads[0]?.opAuthor, "@bob");
    assert.equal(threads[0]?.opParentDerived, true);
  });
});

describe("fetchParentTweet cache semantics", () => {
  beforeEach(() => {
    clearParentTweetCache();
  });

  it("does not cache transient failures (5xx), so a later retry re-fetches", async () => {
    await withSession(async () => {
      let calls = 0;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        calls += 1;
        return jsonResponse({ errors: [{ message: "server error" }] }, 500);
      };
      try {
        assert.equal(await fetchParentTweet({ tweetId: "800" }), null);
        const afterFirst = calls;
        assert.equal(await fetchParentTweet({ tweetId: "800" }), null);
        assert.ok(
          calls > afterFirst,
          "transient miss must not poison the parent cache",
        );
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("does not cache network failures, so a later retry re-fetches", async () => {
    await withSession(async () => {
      let calls = 0;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        calls += 1;
        throw new Error("network down");
      };
      try {
        assert.equal(await fetchParentTweet({ tweetId: "800" }), null);
        const afterFirst = calls;
        assert.equal(await fetchParentTweet({ tweetId: "800" }), null);
        assert.ok(
          calls > afterFirst,
          "network miss must not poison the parent cache",
        );
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("caches a genuine miss (HTTP 404)", async () => {
    await withSession(async () => {
      let calls = 0;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        calls += 1;
        return jsonResponse("Not found", 404);
      };
      try {
        assert.equal(await fetchParentTweet({ tweetId: "800" }), null);
        const afterFirst = calls;
        assert.equal(await fetchParentTweet({ tweetId: "800" }), null);
        assert.equal(
          calls,
          afterFirst,
          "genuine miss should be cached after the first lookup",
        );
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("caches an authoritative 200 miss (no data)", async () => {
    await withSession(async () => {
      let calls = 0;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        calls += 1;
        return jsonResponse({ data: null, errors: [{ detail: "Not Found" }] }, 200);
      };
      try {
        assert.equal(await fetchParentTweet({ tweetId: "800" }), null);
        const afterFirst = calls;
        assert.equal(await fetchParentTweet({ tweetId: "800" }), null);
        assert.equal(
          calls,
          afterFirst,
          "authoritative 200 miss should be cached",
        );
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("caches successful lookups", async () => {
    await withSession(async () => {
      let calls = 0;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        calls += 1;
        return jsonResponse(
          {
            data: {
              id: "800",
              text: "bait root text",
              author_id: "1",
              created_at: "2026-01-01T00:00:00.000Z",
            },
            includes: {
              users: [{ id: "1", username: "bait_op", name: "Bait" }],
            },
          },
          200,
        );
      };
      try {
        const first = await fetchParentTweet({ tweetId: "800" });
        assert.deepEqual(first, {
          author: "@bait_op",
          text: "bait root text",
        });
        const afterFirst = calls;
        const second = await fetchParentTweet({ tweetId: "800" });
        assert.deepEqual(second, {
          author: "@bait_op",
          text: "bait root text",
        });
        assert.equal(calls, afterFirst, "success should be cached");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});

describe("parseTweetsMetricsMap", () => {
  it("maps v2 batch tweets to metrics by id", () => {
    const map = parseTweetsMetricsMap({
      data: [
        {
          id: "11",
          public_metrics: { impression_count: 40, like_count: 2 },
        },
        {
          id: "12",
          public_metrics: { impression_count: 0, like_count: 0 },
        },
      ],
    });
    assert.equal(map.get("11")?.views, 40);
    assert.equal(map.get("11")?.likes, 2);
    assert.equal(map.get("12")?.likes, 0);
  });
});
