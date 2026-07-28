import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clampBucketSize,
  clampTargetCool,
  isCoolThread,
  runScoutCollect,
  type ScoutCollectEvent,
} from "./scoutCollect.ts";
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
  it("clamps targetCool 1–20", () => {
    assert.equal(clampTargetCool(undefined), 8);
    assert.equal(clampTargetCool(4), 4);
    assert.equal(clampTargetCool(20), 20);
    assert.equal(clampTargetCool(21), 20);
  });

  it("allows only bucket sizes 5 or 10", () => {
    assert.equal(clampBucketSize(undefined), 5);
    assert.equal(clampBucketSize(5), 5);
    assert.equal(clampBucketSize(10), 10);
    assert.equal(clampBucketSize(7), 5);
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
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => {
          searchCalls += 1;
          // 3 survivors per search → need 2 searches to fill K=5
          const threads = [1, 2, 3].map(() => {
            id.n += 1;
            return card({ id: `t${id.n}` });
          });
          return { ok: true as const, queryId: "test", threads, bottomCursor: null };
        },
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
    assert.equal(result.event.stopReason, "qualified");
    assert.equal(result.event.coolCount, 1);
  });

  it("discards zero-cool bucket and refills before stopping", async () => {
    let triageCalls = 0;
    const id = { n: 0 };

    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => {
          const threads = [1, 2, 3, 4, 5].map(() => {
            id.n += 1;
            return card({ id: `t${id.n}` });
          });
          return { ok: true as const, queryId: "test", threads, bottomCursor: null };
        },
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
    assert.equal(result.event.stopReason, "qualified");
    assert.equal(result.event.coolCount, 1);
  });

  it("stops after ≥1 cool with no further searches", async () => {
    let searchCalls = 0;
    const id = { n: 0 };

    const result = await runScoutCollect({
      queries: ["q1", "q2", "q3", "q4"],
      bucketSize: 5,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => {
          searchCalls += 1;
          const threads = [1, 2, 3, 4, 5].map(() => {
            id.n += 1;
            return card({ id: `t${id.n}` });
          });
          return { ok: true as const, queryId: "test", threads, bottomCursor: null };
        },
        triageThreads: async ({ threads }) => ({
          threads: threads.map((t) => ({
            ...t,
            engage: "consider" as const,
            baitScore: 15,
          })),
        }),
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.event.stopReason, "qualified");
    assert.ok(result.event.coolCount && result.event.coolCount >= 1);
    assert.equal(searchCalls, 1, "should not keep searching after qualified bucket");
  });

  it("aborted flag short-circuits between steps", async () => {
    const abort = new AbortController();
    let searchCalls = 0;

    const result = await runScoutCollect({
      queries: ["q1", "q2", "q3"],
      bucketSize: 5,
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
      session,
      onEvent: (e) => events.push(e),
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => {
          const threads = [1, 2, 3, 4, 5].map(() => {
            id.n += 1;
            return card({ id: `t${id.n}` });
          });
          return { ok: true as const, queryId: "test", threads, bottomCursor: null };
        },
        triageThreads: async ({ threads }) => ({
          threads: threads.map((t) => ({
            ...t,
            engage: "consider" as const,
            baitScore: 20,
          })),
        }),
      },
    });

    assert.ok(events.some((e) => /Candidates \d+\/5/.test(e.message)));
    assert.ok(events.some((e) => e.stage === "triaging"));
  });
});
