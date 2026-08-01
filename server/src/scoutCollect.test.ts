import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clampBucketSize,
  clampTargetCool,
  isCoolThread,
  runScoutCollect,
  type ScoutCollectEvent,
} from "./scoutCollect.ts";
import { normalizeAuthorKey } from "./interactionStore.ts";
import type { PlanQueriesOpts } from "./queryPlan.ts";
import type { ThreadCard } from "./xSearch.ts";

function card(
  partial: Partial<ThreadCard> & Pick<ThreadCard, "id">,
): ThreadCard {
  return {
    author: "user",
    text: "hello short candidate",
    url: `https://x.com/i/status/${partial.id}`,
    ...partial,
  };
}

function fillBucket(id: { n: number }, n: number): ThreadCard[] {
  return Array.from({ length: n }, () => {
    id.n += 1;
    // Unique authors — per-run author dedupe keeps only one card per authorKey.
    return card({ id: `t${id.n}`, author: `@u${id.n}` });
  });
}

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

describe("runScoutCollect bucket loop", () => {
  const session = {
    authToken: "t",
    ct0: "c",
    configured: true,
  };

  it("fills bucket to K before any triage call", async () => {
    let triageCalls = 0;
    let searchCalls = 0;
    const id = { n: 0 };

    const result = await runScoutCollect({
      queries: ["q1", "q2", "q3"],
      bucketSize: 5,
      targetCool: 1,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => {
          searchCalls += 1;
          // 3 survivors per search → need 2 searches to fill K=5
          return {
            ok: true as const,
            queryId: "test",
            threads: fillBucket(id, 3),
            bottomCursor: null,
          };
        },
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageCalls += 1;
          assert.equal(threads.length, 5);
          return {
            threads: threads.map((t, i) => ({
              ...t,
              engage: i === 0 ? ("consider" as const) : ("skip" as const),
              baitScore: i === 0 ? 20 : 80,
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(triageCalls, 1);
    assert.ok(searchCalls >= 2);
    assert.equal(result.event.stopReason, "target");
    assert.equal(result.event.coolCount, 1);
  });

  it("discards zero-cool bucket and refills before stopping", async () => {
    let triageCalls = 0;
    const id = { n: 0 };

    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => ({
          ok: true as const,
          queryId: "test",
          threads: fillBucket(id, 5),
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageCalls += 1;
          if (triageCalls === 1) {
            return {
              threads: threads.map((t) => ({
                ...t,
                engage: "skip" as const,
                baitScore: 90,
              })),
            };
          }
          return {
            threads: threads.map((t, i) => ({
              ...t,
              engage: i === 0 ? ("priority" as const) : ("skip" as const),
              baitScore: i === 0 ? 10 : 90,
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(triageCalls, 2);
    assert.equal(result.event.stopReason, "target");
    assert.equal(result.event.coolCount, 1);
  });

  it("continues filling until cool target across buckets", async () => {
    let triageCalls = 0;
    let searchCalls = 0;
    const id = { n: 0 };

    const result = await runScoutCollect({
      queries: ["q1", "q2", "q3", "q4"],
      bucketSize: 5,
      targetCool: 5,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => {
          searchCalls += 1;
          return {
            ok: true as const,
            queryId: "test",
            threads: fillBucket(id, 5),
            bottomCursor: null,
          };
        },
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageCalls += 1;
          const coolN = triageCalls === 1 ? 2 : 3;
          return {
            threads: threads.map((t, i) => ({
              ...t,
              engage: i < coolN ? ("consider" as const) : ("skip" as const),
              baitScore: i < coolN ? 15 : 90,
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(triageCalls, 2);
    assert.equal(result.event.stopReason, "target");
    assert.equal(result.event.coolCount, 5);
    assert.equal(searchCalls, 2, "one search per full bucket of 5");
  });

  it("keeps partial cools when later searches are exhausted", async () => {
    let triageCalls = 0;
    const id = { n: 0 };

    const result = await runScoutCollect({
      queries: ["q1", "q2", "q3"],
      bucketSize: 5,
      targetCool: 5,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => {
          if (id.n >= 5) {
            return {
              ok: true as const,
              queryId: "test",
              threads: [],
              bottomCursor: null,
            };
          }
          return {
            ok: true as const,
            queryId: "test",
            threads: fillBucket(id, 5),
            bottomCursor: null,
          };
        },
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageCalls += 1;
          return {
            threads: threads.map((t, i) => ({
              ...t,
              engage: i === 0 ? ("consider" as const) : ("skip" as const),
              baitScore: i === 0 ? 15 : 90,
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(triageCalls, 1);
    assert.equal(result.event.stopReason, "exhausted");
    assert.equal(result.event.coolCount, 1);
  });

  it("triages a stalled partial bucket before exhausting", async () => {
    let triageCalls = 0;
    let triagedIds: string[] = [];
    const id = { n: 0 };

    const result = await runScoutCollect({
      queries: ["q1", "q2", "q3"],
      bucketSize: 5,
      targetCool: 5,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        // First search yields 3 unique authors; further searches add nothing.
        searchTimeline: async () => {
          if (id.n >= 3) {
            return {
              ok: true as const,
              queryId: "test",
              threads: [
                card({ id: "t1", author: "@u1" }),
                card({ id: "t2", author: "@u2" }),
              ],
              bottomCursor: null,
            };
          }
          return {
            ok: true as const,
            queryId: "test",
            threads: fillBucket(id, 3),
            bottomCursor: null,
          };
        },
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageCalls += 1;
          triagedIds = threads.map((t) => t.id);
          return {
            threads: threads.map((t, i) => ({
              ...t,
              engage: i === 0 ? ("consider" as const) : ("skip" as const),
              baitScore: i === 0 ? 15 : 90,
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(triageCalls, 1, "partial bucket must be scored once");
    assert.deepEqual(triagedIds, ["t1", "t2", "t3"]);
    assert.equal(result.event.stopReason, "exhausted");
    assert.equal(result.event.coolCount, 1);
    assert.ok(
      (result.event.threads ?? []).some((t) => t.id === "t1"),
      "cool from partial triage kept",
    );
  });

  it("does not triage when underfill is empty", async () => {
    let triageCalls = 0;

    const result = await runScoutCollect({
      queries: ["q1", "q2"],
      bucketSize: 5,
      targetCool: 5,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => ({
          ok: true as const,
          queryId: "test",
          threads: [],
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageCalls += 1;
          return { threads };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(triageCalls, 0);
    assert.equal(result.event.stopReason, "exhausted");
    assert.equal(result.event.coolCount, 0);
  });

  it("aborted flag short-circuits between steps", async () => {
    const abort = new AbortController();
    let searchCalls = 0;

    const result = await runScoutCollect({
      queries: ["q1", "q2", "q3"],
      bucketSize: 5,
      targetCool: 5,
      session,
      signal: abort.signal,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => {
          searchCalls += 1;
          abort.abort();
          return {
            ok: true as const,
            queryId: "test",
            threads: [card({ id: `a${searchCalls}` })],
            bottomCursor: null,
          };
        },
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => ({
          threads: threads.map((t) => ({
            ...t,
            engage: "skip" as const,
            baitScore: 10,
          })),
        }),
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.event.stopReason, "aborted");
    assert.equal(searchCalls, 1);
  });

  it("emits candidate progress events while filling", async () => {
    const events: ScoutCollectEvent[] = [];
    const id = { n: 0 };

    await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
      session,
      onEvent: (e) => events.push(e),
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => ({
          ok: true as const,
          queryId: "test",
          threads: fillBucket(id, 5),
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => ({
          threads: threads.map((t) => ({
            ...t,
            engage: "consider" as const,
            baitScore: 20,
          })),
        }),
      },
    });

    assert.ok(events.some((e) => /Cand\. \d+\/5/.test(e.message)));
    assert.ok(events.some((e) => e.stage === "triaging"));
    assert.ok(events.some((e) => /Cool \d+\/1/.test(e.message)));
  });

  it("skips bare Cand. progress when a search adds zero", async () => {
    const events: ScoutCollectEvent[] = [];
    let searchCalls = 0;

    await runScoutCollect({
      queries: ["empty1", "empty2", "fill"],
      bucketSize: 5,
      targetCool: 1,
      session,
      onEvent: (e) => events.push(e),
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => {
          searchCalls += 1;
          if (searchCalls <= 2) {
            return {
              ok: true as const,
              queryId: "test",
              threads: [],
              bottomCursor: null,
            };
          }
          return {
            ok: true as const,
            queryId: "test",
            threads: [1, 2, 3, 4, 5].map((n) =>
              card({ id: `t${n}`, author: `@u${n}` }),
            ),
            bottomCursor: null,
          };
        },
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => ({
          threads: threads.map((t) => ({
            ...t,
            engage: "consider" as const,
            baitScore: 20,
          })),
        }),
      },
    });

    const bareCand = events.filter(
      (e) => e.stage === "partial" && /^Cand\. \d+\/\d+$/.test(e.message),
    );
    assert.equal(bareCand.length, 1);
    assert.equal(bareCand[0]?.message, "Cand. 5/5");
  });

  it("hydrates reply parents before triage", async () => {
    let hydrateCalls = 0;
    let sawOp = false;
    const id = { n: 0 };

    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => {
          if (id.n >= 5) {
            return {
              ok: true as const,
              queryId: "test",
              threads: [],
              bottomCursor: null,
            };
          }
          return {
            ok: true as const,
            queryId: "test",
            threads: [1, 2, 3, 4, 5].map((n) => {
              id.n += 1;
              return card({
                id: `r${n}`,
                author: `@r${n}`,
                inReplyToId: `op${n}`,
                isReply: true,
                text: "How do you pick products?",
              });
            }),
            bottomCursor: null,
          };
        },
        hydrateReplyParents: async ({ threads }) => {
          hydrateCalls += 1;
          return {
            threads: threads.map((t) => ({
              ...t,
              opAuthor: "@hustler",
              opText: "mysaas just crossed $632 revenue 100% profit",
            })),
            unhydratedReplyCount: 0,
          };
        },
        triageThreads: async ({ threads }) => {
          sawOp = threads.every((t) => Boolean(t.opText));
          return {
            threads: threads.map((t) => ({
              ...t,
              engage: "skip" as const,
              baitScore: 90,
              flags: ["promo_op"],
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(hydrateCalls, 1);
    assert.equal(sawOp, true);
  });

  it("still triages when parent hydrate soft-fails", async () => {
    let triageCalls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      ({ ok: false, status: 500, text: async () => { throw new Error("mock network error"); } }) as Response;

    try {
      const result = await runScoutCollect({
        queries: ["q1"],
        bucketSize: 5,
        targetCool: 1,
        session,
        deps: {
          sleep: async () => {},
          getCooledAuthorKeys: async () => new Set(),
          saveScoutCache: async () => {},
          searchTimeline: async () => ({
            ok: true as const,
            queryId: "test",
            threads: [1, 2, 3, 4, 5].map((n) =>
              card({
                id: `r${n}`,
                author: `@r${n}`,
                inReplyToId: `op${n}`,
                isReply: true,
              }),
            ),
            bottomCursor: null,
          }),
          triageThreads: async ({ threads }) => {
            triageCalls += 1;
            assert.equal(threads.length, 5);
            return {
              threads: threads.map((t, i) => ({
                ...t,
                engage: i === 0 ? ("consider" as const) : ("skip" as const),
                baitScore: i === 0 ? 20 : 80,
              })),
            };
          },
        },
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(triageCalls, 1);
      assert.equal(result.event.stopReason, "target");
      assert.equal(result.event.unhydratedReplyCount, 5);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("replans with broaden yield opts when searches add zero", async () => {
    const prevKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "test-key";
    const planCalls: Array<{ agenda: string; opts?: PlanQueriesOpts }> = [];
    const events: ScoutCollectEvent[] = [];

    try {
      const result = await runScoutCollect({
        agenda: "Find builders shipping AI tools in public",
        bucketSize: 5,
        targetCool: 1,
        session,
        onEvent: (e) => events.push(e),
        deps: {
          sleep: async () => {},
          getCooledAuthorKeys: async () => new Set(),
          saveScoutCache: async () => {},
          planQueriesFromAgenda: async (agenda, opts) => {
            planCalls.push({ agenda, opts });
            if (planCalls.length === 1) {
              return {
                ok: true as const,
                queries: ["q1", "q2", "q3"],
                model: "test",
                raw: "{}",
              };
            }
            return {
              ok: true as const,
              queries: ["broad AI", "shipped AI"],
              model: "test",
              raw: "{}",
            };
          },
          searchTimeline: async () => ({
            ok: true as const,
            queryId: "test",
            threads: [],
            bottomCursor: null,
          }),
          hydrateReplyParents: async ({ threads }) => ({
            threads,
            unhydratedReplyCount: 0,
          }),
          triageThreads: async ({ threads }) => ({
            threads: threads.map((t) => ({
              ...t,
              engage: "skip" as const,
              baitScore: 90,
            })),
          }),
        },
      });

      assert.equal(result.ok, true);
      assert.ok(planCalls.length >= 2, "initial plan + yield replan");
      assert.equal(planCalls[0]?.opts?.broaden, undefined);
      assert.equal(planCalls[1]?.opts?.broaden, true);
      assert.ok(
        planCalls[1]?.opts?.yieldNote?.includes("Low yield"),
        "yield note passed",
      );
      assert.deepEqual(planCalls[1]?.opts?.priorQueries, ["q1", "q2", "q3"]);
      assert.ok(
        events.some((e) => /broadening search queries/i.test(e.message)),
      );
    } finally {
      if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = prevKey;
    }
  });

  it("keeps at most one card per author in the bucket", async () => {
    let triageAuthors: string[] = [];

    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => ({
          ok: true as const,
          queryId: "test",
          threads: [
            card({ id: "s1", author: "@same" }),
            card({ id: "s2", author: "@same" }),
            card({ id: "s3", author: "@Same" }),
            card({ id: "n1", author: "@alice" }),
            card({ id: "n2", author: "@bob" }),
            card({ id: "n3", author: "@carol" }),
            card({ id: "n4", author: "@dave" }),
          ],
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageAuthors = threads.map((t) => t.author);
          assert.equal(
            threads.filter((t) => normalizeAuthorKey(t.author) === "same")
              .length,
            1,
          );
          return {
            threads: threads.map((t, i) => ({
              ...t,
              engage: i === 0 ? ("consider" as const) : ("skip" as const),
              baitScore: i === 0 ? 20 : 80,
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(triageAuthors.length, 5);
    assert.equal(result.event.stopReason, "target");
  });

  it("drops outbound-link cards before triage", async () => {
    let triageIds: string[] = [];

    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => ({
          ok: true as const,
          queryId: "test",
          threads: [
            card({
              id: "l1",
              author: "@linker",
              text: "Ship this https://example.com/x",
              hasOutboundLink: true,
            }),
            card({
              id: "l2",
              author: "@texturl",
              text: "See https://example.com/abc for details",
            }),
            card({ id: "n1", author: "@alice" }),
            card({ id: "n2", author: "@bob" }),
            card({ id: "n3", author: "@carol" }),
            card({ id: "n4", author: "@dave" }),
            card({ id: "n5", author: "@erin" }),
          ],
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageIds = threads.map((t) => t.id);
          return {
            threads: threads.map((t, i) => ({
              ...t,
              engage: i === 0 ? ("consider" as const) : ("skip" as const),
              baitScore: i === 0 ? 20 : 80,
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(triageIds, ["n1", "n2", "n3", "n4", "n5"]);
    assert.ok(!triageIds.includes("l1") && !triageIds.includes("l2"));
    assert.equal(result.event.stopReason, "target");
  });

  it("drops self-replies before triage", async () => {
    let triageIds: string[] = [];

    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => ({
          ok: true as const,
          queryId: "test",
          threads: [
            card({
              id: "s1",
              author: "@jack",
              inReplyToId: "0",
              inReplyToScreenName: "@jack",
            }),
            card({
              id: "s2",
              author: "@jack",
              inReplyToId: "0",
              inReplyToScreenName: "jack",
            }),
            card({ id: "n1", author: "@alice" }),
            card({ id: "n2", author: "@bob" }),
            card({ id: "n3", author: "@carol" }),
            card({ id: "n4", author: "@dave" }),
            card({ id: "n5", author: "@erin" }),
          ],
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageIds = threads.map((t) => t.id);
          return {
            threads: threads.map((t, i) => ({
              ...t,
              engage: i === 0 ? ("consider" as const) : ("skip" as const),
              baitScore: i === 0 ? 20 : 80,
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(triageIds, ["n1", "n2", "n3", "n4", "n5"]);
    assert.ok(!triageIds.includes("s1") && !triageIds.includes("s2"));
    assert.equal(result.event.stopReason, "target");
  });

  it("drops self-replies revealed only after hydrate (missing inReplyToScreenName)", async () => {
    let triageIds: string[] = [];

    const result = await runScoutCollect({
      queries: ["q1"],
      // Bucket fills with self1 + n1..n4; post-hydrate drops self1 → triage n1..n4.
      bucketSize: 5,
      targetCool: 1,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => ({
          ok: true as const,
          queryId: "test",
          threads: [
            card({
              id: "self1",
              author: "@Kalani_Maluai",
              inReplyToId: "root1",
              isReply: true,
              // GraphQL omitted in_reply_to_screen_name — early filter misses.
            }),
            card({ id: "n1", author: "@alice" }),
            card({ id: "n2", author: "@bob" }),
            card({ id: "n3", author: "@carol" }),
            card({ id: "n4", author: "@dave" }),
            card({ id: "n5", author: "@erin" }),
          ],
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({
          threads: threads.map((t) =>
            t.id === "self1"
              ? {
                  ...t,
                  opAuthor: "@Kalani_Maluai",
                  opText: "root of my own thread",
                  opParentDerived: true,
                }
              : t,
          ),
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageIds = threads.map((t) => t.id);
          return {
            threads: threads.map((t, i) => ({
              ...t,
              engage: i === 0 ? ("consider" as const) : ("skip" as const),
              baitScore: i === 0 ? 20 : 80,
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(!triageIds.includes("self1"));
    assert.deepEqual(triageIds, ["n1", "n2", "n3", "n4"]);
    assert.equal(result.event.stopReason, "target");
  });
});
