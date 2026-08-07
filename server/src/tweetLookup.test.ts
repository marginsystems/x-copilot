import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearParentTweetCache,
  fetchParentTweet,
  hydrateReplyParents,
} from "./tweetLookup.ts";
import type { ThreadCard } from "./xSearch.ts";

function withSession(fn: () => Promise<void>): Promise<void> {
  const prevToken = process.env.X_AUTH_TOKEN;
  const prevCt0 = process.env.X_CT0;
  process.env.X_AUTH_TOKEN = "test-token";
  process.env.X_CT0 = "test-ct0";
  return fn().finally(() => {
    if (prevToken === undefined) delete process.env.X_AUTH_TOKEN;
    else process.env.X_AUTH_TOKEN = prevToken;
    if (prevCt0 === undefined) delete process.env.X_CT0;
    else process.env.X_CT0 = prevCt0;
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

  it("does not cache a stale-query 'Query not found' response", async () => {
    await withSession(async () => {
      let calls = 0;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        calls += 1;
        return jsonResponse("Query not found", 404);
      };
      try {
        assert.equal(await fetchParentTweet({ tweetId: "800" }), null);
        const afterFirst = calls;
        assert.equal(await fetchParentTweet({ tweetId: "800" }), null);
        assert.ok(
          calls > afterFirst,
          "stale-query 'Query not found' must not poison the parent cache",
        );
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("caches an authoritative 200 miss (deleted/private/suspended)", async () => {
    await withSession(async () => {
      let calls = 0;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        calls += 1;
        return jsonResponse(
          { data: { tweetResult: { result: null } } },
          200,
        );
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

  it("does not cache a transient 200 GraphQL error envelope", async () => {
    await withSession(async () => {
      let calls = 0;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        calls += 1;
        return jsonResponse(
          {
            errors: [{ message: "Something went wrong", retryable: true }],
            data: null,
          },
          200,
        );
      };
      try {
        assert.equal(await fetchParentTweet({ tweetId: "800" }), null);
        const afterFirst = calls;
        assert.equal(await fetchParentTweet({ tweetId: "800" }), null);
        assert.ok(
          calls > afterFirst,
          "retryable GraphQL error must not poison the parent cache",
        );
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("caches a non-retryable 200 GraphQL error envelope", async () => {
    await withSession(async () => {
      let calls = 0;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        calls += 1;
        return jsonResponse(
          {
            errors: [
              { message: "Could not find tweet with id: 800", retryable: false },
            ],
            data: null,
          },
          200,
        );
      };
      try {
        assert.equal(await fetchParentTweet({ tweetId: "800" }), null);
        const afterFirst = calls;
        assert.equal(await fetchParentTweet({ tweetId: "800" }), null);
        assert.equal(
          calls,
          afterFirst,
          "non-retryable GraphQL miss should be cached",
        );
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("caches a TweetUnavailable (suspended) result", async () => {
    await withSession(async () => {
      let calls = 0;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        calls += 1;
        return jsonResponse(
          {
            data: {
              tweetResult: {
                result: { __typename: "TweetUnavailable" },
              },
            },
          },
          200,
        );
      };
      try {
        assert.equal(await fetchParentTweet({ tweetId: "800" }), null);
        const afterFirst = calls;
        assert.equal(await fetchParentTweet({ tweetId: "800" }), null);
        assert.equal(
          calls,
          afterFirst,
          "TweetUnavailable miss should be cached",
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
              tweetResult: {
                result: {
                  __typename: "Tweet",
                  rest_id: "800",
                  core: {
                    user_results: {
                      result: {
                        legacy: { screen_name: "bait_op" },
                      },
                    },
                  },
                  legacy: {
                    id_str: "800",
                    full_text: "bait root text",
                    created_at: "Tue Jan 01 00:00:00 +0000 2026",
                  },
                },
              },
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
