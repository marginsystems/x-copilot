import { describe, it, before, beforeEach, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_METRICS_FAILURE_TTL_MS,
  clearLiveMetricsCacheForTests,
  clearParentTweetCache,
  fetchParentTweet,
  fetchTweetMetricsMany,
  hydrateReplyParents,
  parseTweetsMetricsMap,
} from "./tweetLookup.ts";
import type { ThreadCard } from "../scout/threadCard.ts";

function withSession(fn: () => Promise<void>): Promise<void> {
  const prev = process.env.X_API_BEARER_TOKEN;
  process.env.X_API_BEARER_TOKEN = "test-bearer";
  return fn().finally(() => {
    if (prev === undefined) delete process.env.X_API_BEARER_TOKEN;
    else process.env.X_API_BEARER_TOKEN = prev;
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
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

await describe("hydrateReplyParents", async () => {
  beforeEach(() => {
    clearParentTweetCache();
  });

  await it("fills opText for replies missing OP", async () => {
    const { threads, unhydratedReplyCount } = await hydrateReplyParents({
      threads: [replyCard()],
      delayMs: 0,
      fetchParent: async ({ tweetId }) => {
        assert.equal(tweetId, "800");
        return {
          author: "@hustler",
          text: "mysaas just crossed $632 revenue 100% profit",
          createdAt: "2026-01-01T00:00:00.000Z",
        };
      },
    });
    assert.equal(unhydratedReplyCount, 0);
    assert.equal(threads[0]?.opAuthor, "@hustler");
    assert.equal(threads[0]?.opParentDerived, true);
    assert.equal(threads[0]?.opCreatedAt, "2026-01-01T00:00:00.000Z");
    assert.match(threads[0]?.opText ?? "", /\$632/);
    assert.equal(threads[0]?.hasOutboundLink, undefined);
    assert.equal(
      threads[0]?.opCharCount,
      "mysaas just crossed $632 revenue 100% profit".length,
    );
  });

  await it("copies an off-platform parent link onto the reply", async () => {
    const { threads } = await hydrateReplyParents({
      threads: [replyCard()],
      delayMs: 0,
      fetchParent: async () => ({
        author: "@writer",
        text: "Read the rest https://t.co/abc",
        hasOutboundLink: true,
      }),
    });
    assert.equal(threads[0]?.hasOutboundLink, true);
    assert.match(threads[0]?.opText ?? "", /Read the rest/);
  });

  await it("copies parent longform and full char count onto the reply", async () => {
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

  await it("skips lookup when already parent-derived", async () => {
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

  await it("hydrates quote-bearing replies from the reply parent", async () => {
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

  await it("soft-fails when parent lookup returns null", async () => {
    const { threads, unhydratedReplyCount } = await hydrateReplyParents({
      threads: [replyCard()],
      delayMs: 0,
      fetchParent: async () => null,
    });
    assert.equal(unhydratedReplyCount, 1);
    assert.equal(threads[0]?.opText, undefined);
    assert.equal(threads[0]?.text, "How do you pick products?");
  });

  await it("prefers conversation root when nested (parent ≠ root)", async () => {
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

  await it("drops nested replies when the conversation root is unavailable", async () => {
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
    assert.equal(unhydratedReplyCount, 1);
    assert.equal(threads[0]?.opAuthor, undefined);
    assert.equal(threads[0]?.opParentDerived, undefined);
  });

  await it("marks nested self-replies via the immediate parent (root author differs)", async () => {
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

  await it("drops nested replies when the conversation root is the card author's own thread", async () => {
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
    assert.equal(unhydratedReplyCount, 1);
    assert.equal(threads[0]?.opAuthor, undefined);
    assert.equal(threads[0]?.opParentDerived, undefined);
  });
});

await describe("fetchParentTweet cache semantics", async () => {
  beforeEach(() => {
    clearParentTweetCache();
  });

  await it("does not cache transient failures (5xx), so a later retry re-fetches", async () => {
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

  await it("does not cache network failures, so a later retry re-fetches", async () => {
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

  await it("caches a genuine miss (HTTP 404)", async () => {
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

  await it("caches an authoritative 200 miss (no data)", async () => {
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

  await it("caches successful lookups", async () => {
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
          createdAt: "2026-01-01T00:00:00.000Z",
        });
        const afterFirst = calls;
        const second = await fetchParentTweet({ tweetId: "800" });
        assert.deepEqual(second, {
          author: "@bait_op",
          text: "bait root text",
          createdAt: "2026-01-01T00:00:00.000Z",
        });
        assert.equal(calls, afterFirst, "success should be cached");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  await it("follows OP t.co via expanded_url and copies the outbound flag onto the reply", async () => {
    await withSession(async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        jsonResponse(
          {
            data: {
              id: "2091161452241354978",
              text: "The End of Computers https://t.co/TxGWwcccfl",
              author_id: "1184496773970173952",
              entities: {
                urls: [
                  {
                    url: "https://t.co/TxGWwcccfl",
                    expanded_url:
                      "https://sergeynog.substack.com/p/the-end-of-computers",
                    display_url: "sergeynog.substack.com/p/the-end-of-c…",
                  },
                ],
              },
            },
            includes: {
              users: [
                {
                  id: "1184496773970173952",
                  username: "sergey_nog",
                  name: "Sergey Gorbunov",
                },
              ],
            },
          },
          200,
        );
      try {
        const parent = await fetchParentTweet({
          tweetId: "2091161452241354978",
        });
        assert.equal(parent?.author, "@sergey_nog");
        assert.equal(parent?.hasOutboundLink, true);
        const { threads } = await hydrateReplyParents({
          threads: [
            replyCard({
              id: "2092650080306119014",
              author: "@sasasenor",
              text: "Great article. https://t.co/zK5ZiEkdNn",
              url: "https://x.com/sasasenor/status/2092650080306119014",
              inReplyToId: "2091161452241354978",
              mediaShortlinks: ["t.co/zk5ziekdnn"],
            }),
          ],
          delayMs: 0,
          fetchParent: async () => parent,
        });
        assert.equal(threads[0]?.hasOutboundLink, true);
        assert.match(threads[0]?.opText ?? "", /The End of Computers/);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  await it("copies an OP website card_uri onto the reply with no URL entities", async () => {
    await withSession(async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        jsonResponse(
          {
            data: {
              id: "2087820145578103161",
              text: "I spent five years in corporate sales. Corporatish.",
              author_id: "1898190900041265152",
              card_uri: "card://2087820143858499584",
              entities: { urls: [] },
            },
            includes: {
              users: [
                {
                  id: "1898190900041265152",
                  username: "RafaelDaVentys",
                  name: "Rafael DaVentys",
                },
              ],
            },
          },
          200,
        );
      try {
        const parent = await fetchParentTweet({
          tweetId: "2087820145578103161",
        });
        assert.equal(parent?.author, "@RafaelDaVentys");
        assert.equal(parent?.hasOutboundLink, true);
        const { threads } = await hydrateReplyParents({
          threads: [
            replyCard({
              id: "2093404586795262199",
              author: "@IssanCARefugee",
              text: "I was in it 6 yrs, SV tech sales.",
              url: "https://x.com/IssanCARefugee/status/2093404586795262199",
              inReplyToId: "2087820145578103161",
            }),
          ],
          delayMs: 0,
          fetchParent: async () => parent,
        });
        assert.equal(threads[0]?.hasOutboundLink, true);
        assert.match(threads[0]?.opText ?? "", /Corporatish/);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  await it("flags a note_tweet parent with an off-platform note entity link", async () => {
    await withSession(async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        jsonResponse(
          {
            data: {
              id: "800",
              text: "teaser",
              author_id: "1",
              note_tweet: {
                text: "Long essay https://t.co/abc",
                entity_set: {
                  urls: [
                    {
                      url: "https://t.co/abc",
                      expanded_url: "https://substack.com/p/long",
                    },
                  ],
                },
              },
            },
            includes: {
              users: [{ id: "1", username: "writer", name: "Writer" }],
            },
          },
          200,
        );
      try {
        const parent = await fetchParentTweet({ tweetId: "800" });
        assert.equal(parent?.author, "@writer");
        assert.equal(parent?.hasOutboundLink, true);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});

await describe("parseTweetsMetricsMap", async () => {
  await it("maps v2 batch tweets to metrics by id", () => {
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

function metricsBody(ids: string[]): unknown {
  return {
    data: ids.map((id) => ({
      id,
      public_metrics: { impression_count: 100, like_count: 3 },
    })),
  };
}

function requestedIds(input: string | URL | Request): string[] {
  const url = new URL(input instanceof Request ? input.url : String(input));
  return (url.searchParams.get("ids") ?? "").split(",");
}

await describe("fetchTweetMetricsMany budget, failure cache and abort", async () => {
  const origFetch = globalThis.fetch;
  const prevToken = process.env.X_API_BEARER_TOKEN;
  let warn: ReturnType<typeof mock.method<Console, "warn">>;

  before(() => {
    warn = mock.method(console, "warn", () => {});
  });

  after(() => {
    warn.mock.restore();
  });

  beforeEach(() => {
    clearLiveMetricsCacheForTests();
    process.env.X_API_BEARER_TOKEN = "test-bearer";
    warn.mock.resetCalls();
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    mock.timers.reset();
    if (prevToken === undefined) delete process.env.X_API_BEARER_TOKEN;
    else process.env.X_API_BEARER_TOKEN = prevToken;
  });

  await it("returns cached-only metrics when the budget elapses and warms the cache in the background", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    let finished: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      finished = resolve;
    });
    globalThis.fetch = async (input) => {
      calls += 1;
      await gate;
      queueMicrotask(finished);
      return jsonResponse(metricsBody(requestedIds(input)), 200);
    };

    const startedAt = Date.now();
    const first = await fetchTweetMetricsMany({ tweetIds: ["1", "2"], waitMs: 20 });
    assert.ok(Date.now() - startedAt < 1000);
    assert.equal(first.size, 0);
    assert.equal(calls, 1);

    release();
    await done;
    await new Promise((resolve) => setImmediate(resolve));

    const second = await fetchTweetMetricsMany({ tweetIds: ["1", "2"], waitMs: 20 });
    assert.equal(calls, 1);
    assert.equal(second.get("1")?.views, 100);
    assert.equal(second.get("2")?.likes, 3);
  });

  await it("negative-caches a failed lookup for the failure TTL, then retries", async () => {
    mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return jsonResponse({ errors: [{ message: "server error" }] }, 503);
    };

    assert.equal((await fetchTweetMetricsMany({ tweetIds: ["7"] })).size, 0);
    assert.equal(calls, 1);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0]?.arguments[0]), /\[live-metrics\].*ids=1/);

    assert.equal((await fetchTweetMetricsMany({ tweetIds: ["7"] })).size, 0);
    assert.equal(calls, 1);

    mock.timers.tick(LIVE_METRICS_FAILURE_TTL_MS);
    globalThis.fetch = async (input) => {
      calls += 1;
      return jsonResponse(metricsBody(requestedIds(input)), 200);
    };
    const retried = await fetchTweetMetricsMany({ tweetIds: ["7"] });
    assert.equal(calls, 2);
    assert.equal(retried.get("7")?.views, 100);
  });

  await it("keeps caching confirmed absence from a successful batch", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return jsonResponse(metricsBody(["1"]), 200);
    };
    const first = await fetchTweetMetricsMany({ tweetIds: ["1", "gone"] });
    assert.deepEqual([...first.keys()], ["1"]);
    const second = await fetchTweetMetricsMany({ tweetIds: ["1", "gone"] });
    assert.deepEqual([...second.keys()], ["1"]);
    assert.equal(calls, 1);
    assert.equal(warn.mock.callCount(), 0);
  });

  await it("shares one in-flight lookup between concurrent callers", async () => {
    let calls = 0;
    globalThis.fetch = async (input) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse(metricsBody(requestedIds(input)), 200);
    };
    const [a, b] = await Promise.all([
      fetchTweetMetricsMany({ tweetIds: ["1", "2"] }),
      fetchTweetMetricsMany({ tweetIds: ["2", "1"] }),
    ]);
    assert.equal(calls, 1);
    assert.equal(a.get("1")?.views, 100);
    assert.equal(b.get("2")?.views, 100);
  });

  await it("aborts the X call when the only caller disconnects and does not negative-cache it", async () => {
    let fetchSignal: AbortSignal | undefined;
    let calls = 0;
    globalThis.fetch = (_input, init) => {
      calls += 1;
      fetchSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        fetchSignal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    };
    const client = new AbortController();
    const pending = fetchTweetMetricsMany({
      tweetIds: ["5"],
      signal: client.signal,
      waitMs: 60_000,
    });
    await new Promise((resolve) => setImmediate(resolve));
    client.abort();
    assert.equal((await pending).size, 0);
    assert.equal(fetchSignal?.aborted, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(warn.mock.callCount(), 0);

    globalThis.fetch = async (input) => {
      calls += 1;
      return jsonResponse(metricsBody(requestedIds(input)), 200);
    };
    const retried = await fetchTweetMetricsMany({ tweetIds: ["5"] });
    assert.equal(calls, 2);
    assert.equal(retried.get("5")?.views, 100);
  });

  await it("keeps a shared lookup running while another caller still waits", async () => {
    let fetchSignal: AbortSignal | undefined;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = async (input, init) => {
      fetchSignal = init?.signal ?? undefined;
      await gate;
      return jsonResponse(metricsBody(requestedIds(input)), 200);
    };
    const leaving = new AbortController();
    const staying = new AbortController();
    const left = fetchTweetMetricsMany({ tweetIds: ["9"], signal: leaving.signal });
    const stayed = fetchTweetMetricsMany({ tweetIds: ["9"], signal: staying.signal });
    await new Promise((resolve) => setImmediate(resolve));
    leaving.abort();
    assert.equal((await left).size, 0);
    assert.equal(fetchSignal?.aborted, false);
    release();
    assert.equal((await stayed).get("9")?.views, 100);
  });
});
