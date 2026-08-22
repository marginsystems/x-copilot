import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runScoutCollect } from "./scoutCollect.ts";
import { card, fillBucket } from "./scoutCollect.testHelpers.ts";
import type { ScoutCollectEvent } from "./scoutTypes.ts";
import { normalizeAuthorKey } from "./interactionStore.ts";
import type { PlanQueriesOpts } from "./queryPlan.ts";
import type { ThreadCard } from "./threadCard.ts";

describe("runScoutCollect stop", () => {
  const session = {
    bearerToken: "t",
    configured: true,
  };

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

});
