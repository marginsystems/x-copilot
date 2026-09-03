import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runScoutCollect } from "./scoutCollect.ts";
import { card, fillBucket } from "./scoutCollect.testHelpers.ts";
import type { ScoutCollectEvent } from "./scoutTypes.ts";
import { normalizeAuthorKey } from "./interactionCooldown.ts";
import type { PlanQueriesOpts } from "./queryPlan.ts";
import type { ThreadCard } from "./threadCard.ts";

describe("runScoutCollect bucket loop", () => {
  const session = {
    bearerToken: "t",
    configured: true,
  };

  it("asks search for one page with referenced-tweet expansions", async () => {
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
    assert.equal(seen[0]?.expandReferenced, true);
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

});
