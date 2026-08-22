import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runScoutCollect } from "./scoutCollect.ts";
import { card, fillBucket } from "./scoutCollect.testHelpers.ts";
import type { ScoutCollectEvent } from "./scoutTypes.ts";
import { normalizeAuthorKey } from "./interactionCooldown.ts";
import type { PlanQueriesOpts } from "./queryPlan.ts";
import type { ThreadCard } from "./threadCard.ts";

describe("runScoutCollect events", () => {
  const session = {
    bearerToken: "t",
    configured: true,
  };

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

});
