import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runScoutCollect } from "./scoutCollect.ts";
import { card, fillBucket } from "./scoutCollect.testHelpers.ts";
import { MAX_SEARCH_CALLS } from "./scoutPolicy.ts";

describe("runScoutCollect query cursors", () => {
  const session = {
    bearerToken: "t",
    configured: true,
  };

  it("resumes the same query with its cursor and stable start time", async () => {
    const seen: Array<{ cursor?: string; startTime?: string }> = [];
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
        searchTimeline: async (opts) => {
          seen.push({ cursor: opts.cursor, startTime: opts.startTime });
          return {
            ok: true as const,
            queryId: "test",
            threads: fillBucket(id, seen.length === 1 ? 1 : 4),
            bottomCursor: seen.length === 1 ? "next-page" : null,
          };
        },
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => ({
          threads: threads.map((thread, index) => ({
            ...thread,
            engage: index === 0 ? ("consider" as const) : ("skip" as const),
            baitScore: index === 0 ? 10 : 90,
          })),
        }),
      },
    });

    assert.equal(result.ok, true);
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.cursor, undefined);
    assert.equal(seen[1]?.cursor, "next-page");
    assert.ok(seen[0]?.startTime);
    assert.equal(seen[1]?.startTime, seen[0]?.startTime);
  });

  it("does not search an exhausted query from page one again", async () => {
    const calls: string[] = [];

    const result = await runScoutCollect({
      queries: ["q1", "q2"],
      bucketSize: 5,
      targetCool: 1,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async (opts) => {
          calls.push(opts.query);
          return {
            ok: true as const,
            queryId: "test",
            threads: calls.length === 1 ? [card({ id: "only" })] : [],
            bottomCursor: null,
          };
        },
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => ({
          threads: threads.map((thread) => ({
            ...thread,
            engage: "consider" as const,
            baitScore: 10,
          })),
        }),
      },
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls.filter((query) => query.startsWith("q1 ")).length, 1);
    assert.equal(calls.filter((query) => query.startsWith("q2 ")).length, 1);
  });

  it("scores the partial bucket after one replan and bounded stall", async () => {
    const priorKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "test";
    const calls: Array<{ query: string; cursor?: string; startTime?: string }> = [];
    let planCalls = 0;
    let triageCalls = 0;

    try {
      const result = await runScoutCollect({
        agenda: "shipping",
        queries: ["narrow"],
        bucketSize: 5,
        targetCool: 1,
        session,
        deps: {
          sleep: async () => {},
          getCooledAuthorKeys: async () => new Set(),
          saveScoutCache: async () => {},
          planQueriesFromAgenda: async () => {
            planCalls += 1;
            return {
              ok: true as const,
              queries: ["broad"],
              model: "test",
              provider: "deepseek" as const,
              raw: "{}",
            };
          },
          searchTimeline: async (opts) => {
            calls.push({
              query: opts.query,
              cursor: opts.cursor,
              startTime: opts.startTime,
            });
            return {
              ok: true as const,
              queryId: "test",
              threads:
                calls.length === 1
                  ? [card({ id: "partial", author: "@partial" })]
                  : [card({ id: "partial", author: "@partial" })],
              bottomCursor: `cursor-${calls.length}`,
            };
          },
          hydrateReplyParents: async ({ threads }) => ({
            threads,
            unhydratedReplyCount: 0,
          }),
          triageThreads: async ({ threads }) => {
            triageCalls += 1;
            return {
              threads: threads.map((thread) => ({
                ...thread,
                engage: "consider" as const,
                baitScore: 10,
              })),
            };
          },
        },
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(planCalls, 1);
      assert.equal(calls.length, 4);
      assert.equal(triageCalls, 1);
      assert.equal(result.event.coolCount, 1);
      assert.equal(result.event.stopReason, "target");
      assert.equal(calls[1]?.cursor, undefined);
      assert.ok(calls.slice(2).every((call) => call.cursor));
      assert.equal(calls[2]?.startTime, calls[1]?.startTime);
      assert.equal(calls[3]?.startTime, calls[1]?.startTime);
    } finally {
      if (priorKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = priorKey;
    }
  });

  it("keeps the Scout search budget at 48", () => {
    assert.equal(MAX_SEARCH_CALLS, 48);
  });
});
