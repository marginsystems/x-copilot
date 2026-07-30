import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  STATS_T1H_MS,
  STATS_T24H_MS,
  listInteractionHistory,
  markInteracted,
  selectDueStatSamples,
  type Interaction,
} from "./interactionStore.ts";
import { runStatsTick, shouldRunStatsMain } from "./statsWorker.ts";

describe("shouldRunStatsMain", () => {
  it("returns true for direct statsWorker.js / .ts entry", () => {
    assert.equal(
      shouldRunStatsMain("/root/x-copilot/server/dist/statsWorker.js"),
      true,
    );
    assert.equal(
      shouldRunStatsMain("/root/x-copilot/server/src/statsWorker.ts"),
      true,
    );
  });

  it("returns true under PM2 ProcessContainerFork when pm_id is set", () => {
    assert.equal(
      shouldRunStatsMain(
        "/usr/lib/node_modules/pm2/lib/ProcessContainerFork.js",
        { pm_id: "1" },
      ),
      true,
    );
  });

  it("returns false for ProcessContainerFork without pm_id", () => {
    assert.equal(
      shouldRunStatsMain(
        "/usr/lib/node_modules/pm2/lib/ProcessContainerFork.js",
        {},
      ),
      false,
    );
  });

  it("returns false for test-runner style argv", () => {
    assert.equal(
      shouldRunStatsMain("/root/x-copilot/node_modules/tsx/dist/cli.mjs", {
        pm_id: undefined,
      }),
      false,
    );
  });
});

describe("selectDueStatSamples", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");

  it("skips rows without replyId", () => {
    const rows: Interaction[] = [
      {
        threadId: "1",
        author: "@a",
        authorKey: "a",
        at: new Date(now - STATS_T1H_MS - 1).toISOString(),
        source: "manual",
      },
    ];
    assert.equal(selectDueStatSamples(rows, now).length, 0);
  });

  it("returns t1h when age >= 1h and snapshot missing", () => {
    const postedAt = new Date(now - STATS_T1H_MS - 1000).toISOString();
    const rows: Interaction[] = [
      {
        threadId: "1",
        author: "@a",
        authorKey: "a",
        at: postedAt,
        postedAt,
        replyId: "99",
        replyUrl: "https://x.com/me/status/99",
        source: "manual",
      },
    ];
    const due = selectDueStatSamples(rows, now);
    assert.equal(due.length, 1);
    assert.equal(due[0]?.checkpoint, "t1h");
    assert.equal(due[0]?.replyId, "99");
  });

  it("returns both checkpoints when 24h due and both missing", () => {
    const postedAt = new Date(now - STATS_T24H_MS - 1000).toISOString();
    const rows: Interaction[] = [
      {
        threadId: "1",
        author: "@a",
        authorKey: "a",
        at: postedAt,
        postedAt,
        replyId: "99",
        source: "manual",
      },
    ];
    const due = selectDueStatSamples(rows, now, 10);
    assert.deepEqual(
      due.map((d) => d.checkpoint).sort(),
      ["t1h", "t24h"],
    );
  });

  it("omits checkpoints that already have snapshots", () => {
    const postedAt = new Date(now - STATS_T24H_MS - 1000).toISOString();
    const rows: Interaction[] = [
      {
        threadId: "1",
        author: "@a",
        authorKey: "a",
        at: postedAt,
        postedAt,
        replyId: "99",
        source: "manual",
        stats: {
          t1h: { views: 1, likes: 0, sampledAt: postedAt },
        },
      },
    ];
    const due = selectDueStatSamples(rows, now);
    assert.equal(due.length, 1);
    assert.equal(due[0]?.checkpoint, "t24h");
  });
});

describe("runStatsTick", () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-copilot-stats-"));
    storePath = join(dir, "interactions.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("fills t1h snapshot when metrics fetch succeeds", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    await markInteracted({
      threadId: "parent",
      author: "@target",
      replyId: "reply1",
      replyUrl: "https://x.com/me/status/reply1",
      nowMs: now - STATS_T1H_MS - 5000,
      storePath,
    });

    const result = await runStatsTick({
      nowMs: now,
      storePath,
      delayMs: 0,
      fetchMetrics: async ({ tweetId }) => {
        assert.equal(tweetId, "reply1");
        return { views: 100, likes: 4, replies: 1, retweets: 0 };
      },
    });
    assert.equal(result.due, 1);
    assert.equal(result.sampled, 1);
    assert.equal(result.failed, 0);

    const history = await listInteractionHistory({ storePath });
    assert.equal(history[0]?.stats?.t1h?.views, 100);
    assert.equal(history[0]?.stats?.t1h?.likes, 4);
  });

  it("soft-fails leave slot open for retry", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    await markInteracted({
      threadId: "parent",
      author: "@target",
      replyId: "reply1",
      replyUrl: "https://x.com/me/status/reply1",
      nowMs: now - STATS_T1H_MS - 5000,
      storePath,
    });

    const result = await runStatsTick({
      nowMs: now,
      storePath,
      delayMs: 0,
      fetchMetrics: async () => null,
    });
    assert.equal(result.failed, 1);
    assert.equal(result.sampled, 0);

    const stillDue = selectDueStatSamples(
      await listInteractionHistory({ storePath }),
      now,
    );
    assert.equal(stillDue.length, 1);
  });
});
