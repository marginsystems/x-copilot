import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
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
    text: "hello",
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
    assert.equal(
      isCoolThread(card({ id: "3", engage: "consider", score: 30 })),
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
    assert.equal(
      isCoolThread(card({ id: "3", engage: "consider" })),
      false,
    );
  });
});

describe("clampTargetCool", () => {
  it("defaults and clamps 1–10", () => {
    assert.equal(clampTargetCool(undefined), 8);
    assert.equal(clampTargetCool(3.5), 8);
    assert.equal(clampTargetCool(0), 1);
    assert.equal(clampTargetCool(11), 10);
    assert.equal(clampTargetCool(4), 4);
  });
});

describe("runScoutCollect", () => {
  const session = {
    authToken: "t",
    ct0: "c",
    configured: true,
  };

  it("stops when target cool threads are met", async () => {
    let searchCalls = 0;
    const events: ScoutCollectEvent[] = [];

    const result = await runScoutCollect({
      queries: ["q1", "q2", "q3"],
      targetCool: 2,
      session,
      onEvent: (e) => events.push(e),
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => {
          searchCalls += 1;
          const base = searchCalls * 10;
          return {
            ok: true as const,
            queryId: "test",
            threads: [
              card({ id: String(base + 1), text: "a" }),
              card({ id: String(base + 2), text: "b" }),
              card({ id: String(base + 3), text: "c" }),
              card({ id: String(base + 4), text: "d" }),
            ],
          };
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

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.event.stopReason, "target");
    assert.equal(result.event.coolCount, 2);
    assert.equal(result.event.threads?.length, 2);
    assert.ok(searchCalls <= 2, `expected early stop, got ${searchCalls} searches`);
    assert.ok(events.some((e) => e.stage === "partial"));
  });

  it("aborted flag short-circuits between steps", async () => {
    const abort = new AbortController();
    let searchCalls = 0;

    const result = await runScoutCollect({
      queries: ["q1", "q2", "q3"],
      targetCool: 8,
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
            threads: [
              card({ id: `a${searchCalls}`, text: "x" }),
              card({ id: `b${searchCalls}`, text: "y" }),
              card({ id: `c${searchCalls}`, text: "z" }),
              card({ id: `d${searchCalls}`, text: "w" }),
            ],
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
    assert.ok(searchCalls < 3, `expected abort before all queries, got ${searchCalls}`);
  });
});
