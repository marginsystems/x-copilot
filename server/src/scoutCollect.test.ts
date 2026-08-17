import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clampBucketSize,
  clampTargetCool,
  isCoolThread,
  runScoutCollect,
  withScoutSearchExclusions,
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

describe("runScoutCollect bucket loop", () => {
  const session = {
    bearerToken: "t",
    configured: true,
  };

  it("asks search for one page and no referenced-tweet expansions", async () => {
    const seen: Array<{
      query?: string;
      maxPages?: number;
      expandReferenced?: boolean;
    }> = [];
    const id = { n: 0 };
    await runScoutCollect({
      queries: ["shipping AI"],
      bucketSize: 5,
      targetCool: 1,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async (opts) => {
          seen.push({
            query: opts.query,
            maxPages: opts.maxPages,
            expandReferenced: opts.expandReferenced,
          });
          return {
            ok: true as const,
            queryId: "test",
            threads: fillBucket(id, 5),
            bottomCursor: "more",
          };
        },
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => ({
          threads: threads.map((t, i) => ({
            ...t,
            engage: i === 0 ? ("consider" as const) : ("skip" as const),
            baitScore: i === 0 ? 20 : 80,
          })),
        }),
      },
    });
    assert.ok(seen.length >= 1);
    assert.equal(seen[0]?.maxPages, 1);
    assert.equal(seen[0]?.expandReferenced, false);
    assert.match(seen[0]?.query ?? "", /-is:retweet/);
  });

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

  it("excludes default supportive encouragement from cool and refills", async () => {
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
            // Would be cool on engage/bait alone, but intent is excluded by default.
            return {
              threads: threads.map((t) => ({
                ...t,
                engage: "priority" as const,
                baitScore: 10,
                intent: "supportive encouragement",
                flags: ["genuine_question"],
              })),
            };
          }
          return {
            threads: threads.map((t, i) => ({
              ...t,
              engage: i === 0 ? ("priority" as const) : ("skip" as const),
              baitScore: i === 0 ? 12 : 90,
              intent: "shipping question",
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(triageCalls >= 2, "must refill after tag-excluded cools");
    assert.equal(result.event.stopReason, "target");
    assert.equal(result.event.coolCount, 1);
    assert.equal(result.event.threads?.[0]?.intent, "shipping question");
    assert.ok(
      !(result.event.threads ?? []).some(
        (t) => t.intent === "supportive encouragement",
      ),
    );
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

  it("stops mid-run with credits_exhausted when the credit gate closes", async () => {
    let gateCalls = 0;
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
        creditGate: async () => {
          gateCalls += 1;
          // Allow the first search to read, then cut the pool mid-run.
          return gateCalls === 1;
        },
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
          threads: threads.map((t, i) => ({
            ...t,
            engage: i === 0 ? ("consider" as const) : ("skip" as const),
            baitScore: i === 0 ? 15 : 90,
          })),
        }),
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.event.stopReason, "credits_exhausted");
    assert.equal(result.event.coolCount, 1);
    assert.match(result.event.message, /credits/);
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

  it("persists cools to cache on each cool partial", async () => {
    const cacheSnaps: Array<{ threads: ThreadCard[] }> = [];
    const id = { n: 0 };
    let triageCalls = 0;

    const result = await runScoutCollect({
      queries: ["q1", "q2"],
      bucketSize: 5,
      targetCool: 2,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async (snap) => {
          cacheSnaps.push({ threads: [...snap.threads] });
          return snap;
        },
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
    assert.equal(result.event.stopReason, "target");
    assert.equal(triageCalls, 2);
    // Mid-run saves after each cool growth + final done save.
    assert.ok(cacheSnaps.length >= 3, `expected mid-run + final saves, got ${cacheSnaps.length}`);
    assert.equal(cacheSnaps[0].threads.length, 1);
    assert.equal(cacheSnaps[1].threads.length, 2);
    assert.ok(
      cacheSnaps.some((s) => s.threads.length === 2),
      "cache should hold both cools before done",
    );
  });

  it("persists cools before abort tears down the run", async () => {
    const abort = new AbortController();
    const cacheSnaps: Array<{ threads: ThreadCard[] }> = [];
    const id = { n: 0 };
    let triageCalls = 0;

    const result = await runScoutCollect({
      queries: ["q1", "q2", "q3"],
      bucketSize: 5,
      targetCool: 5,
      session,
      signal: abort.signal,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async (snap) => {
          cacheSnaps.push({ threads: [...snap.threads] });
          return snap;
        },
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
          const scored = threads.map((t, i) => ({
            ...t,
            engage: i === 0 ? ("consider" as const) : ("skip" as const),
            baitScore: i === 0 ? 15 : 90,
          }));
          // Abort after first cool bucket qualifies (mid-run cache already written).
          if (triageCalls === 1) abort.abort();
          return { threads: scored };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.event.stopReason, "aborted");
    assert.ok(cacheSnaps.length >= 1, "mid-run cools must be cached");
    assert.ok(
      cacheSnaps[0].threads.length >= 1,
      "aborted run still persisted at least one cool",
    );
    assert.equal(result.event.coolCount, 1);
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
                text: "How do you pick which products to build next for your customers?",
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
              opText:
                "mysaas just crossed $632 revenue this month with 100% profit on the dashboard",
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

  it("suppresses cool replies under a bait-tagged conversation root", async () => {
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
              id: "bait-root",
              author: "@bait",
              conversationId: "bait-root",
              text: "why is Japan so behind in AI what happened?",
            }),
            card({
              id: "victim-reply",
              author: "@victim",
              conversationId: "bait-root",
              inReplyToId: "bait-root",
              isReply: true,
              text: "Japan builds things that have to work on day one.",
            }),
            ...[3, 4, 5].map((n) =>
              card({ id: `pad${n}`, author: `@pad${n}`, text: "filler" }),
            ),
          ],
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => ({
          threads: threads.map((t) => {
            if (t.id === "bait-root") {
              return {
                ...t,
                engage: "skip" as const,
                baitScore: 90,
                flags: ["engagement_bait"],
              };
            }
            if (t.id === "victim-reply") {
              return {
                ...t,
                engage: "consider" as const,
                baitScore: 15,
                flags: ["on_agenda"],
              };
            }
            return {
              ...t,
              engage: "skip" as const,
              baitScore: 80,
            };
          }),
        }),
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.event.coolCount, 0);
    assert.equal(
      (result.event.threads ?? []).some((t) => t.id === "victim-reply"),
      false,
    );
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
        filters: {},
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
                provider: "deepseek" as const,
                raw: "{}",
              };
            }
            return {
              ok: true as const,
              queries: ["broad AI", "shipped AI"],
              model: "test",
              provider: "deepseek" as const,
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

  it("drops replies under a hydrated Article parent before triage", async () => {
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
              id: "art-reply",
              author: "@reader",
              inReplyToId: "art1",
              isReply: true,
              text: "Great piece, thanks for writing this up.",
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
            t.id === "art-reply"
              ? {
                  ...t,
                  opAuthor: "@writer",
                  opText: "Short article teaser",
                  opLongform: "article" as const,
                  opCharCount: 20,
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
    assert.ok(!triageIds.includes("art-reply"));
    assert.deepEqual(triageIds, ["n1", "n2", "n3", "n4"]);
    assert.equal(result.event.stopReason, "target");
  });

  it("drops replies under a parent over the char cap after hydrate", async () => {
    let triageIds: string[] = [];

    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
      session,
      filters: { maxThreadChars: 400 },
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => ({
          ok: true as const,
          queryId: "test",
          threads: [
            card({
              id: "long-parent-reply",
              author: "@reader",
              inReplyToId: "wall1",
              isReply: true,
              text: "This is the bit I keep coming back to.",
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
            t.id === "long-parent-reply"
              ? {
                  ...t,
                  opAuthor: "@essayist",
                  opText: "preview",
                  opCharCount: 900,
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
    assert.ok(!triageIds.includes("long-parent-reply"));
    assert.deepEqual(triageIds, ["n1", "n2", "n3", "n4"]);
    assert.equal(result.event.stopReason, "target");
  });

  it("exhausts when the post-hydrate length filter empties a partial bucket", async () => {
    let triageCalls = 0;
    let searchCalls = 0;

    const result = await runScoutCollect({
      queries: ["q1", "q2"],
      bucketSize: 5,
      targetCool: 5,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        // First page yields a partial bucket of replies; supply is empty after.
        searchTimeline: async () => {
          searchCalls += 1;
          if (searchCalls === 1) {
            return {
              ok: true as const,
              queryId: "test",
              threads: [1, 2, 3].map((n) =>
                card({
                  id: `r${n}`,
                  author: `@r${n}`,
                  inReplyToId: `op${n}`,
                  isReply: true,
                  text: "How do you pick which products to build?",
                }),
              ),
              bottomCursor: null,
            };
          }
          return {
            ok: true as const,
            queryId: "test",
            threads: [],
            bottomCursor: null,
          };
        },
        // Hydrate reveals every replied-to parent is oversized.
        hydrateReplyParents: async ({ threads }) => ({
          threads: threads.map((t) => ({
            ...t,
            opAuthor: "@parent",
            opText: "preview",
            opCharCount: 900,
            opParentDerived: true,
          })),
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
    assert.equal(triageCalls, 0, "length-emptied bucket must not reach triage");
    assert.equal(result.event.stopReason, "exhausted");
  });

  it("drops non-preferred-language cards before triage", async () => {
    let triageIds: string[] = [];
    const spanish =
      "Ahora que todos están quejándose de build in public, voy yo: dejé de hacer build in public porque me copiaban todo, literalmente todo, hasta las publicaciones sobre qué roles contratábamos.";

    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
      session,
      filters: { preferredLanguage: "en" },
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => ({
          ok: true as const,
          queryId: "test",
          threads: [
            card({
              id: "es1",
              author: "@ssebita_r",
              text: spanish,
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
    assert.ok(!triageIds.includes("es1"));
    assert.deepEqual(triageIds, ["n1", "n2", "n3", "n4", "n5"]);
    assert.equal(result.event.stopReason, "target");
  });
});
