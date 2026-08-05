import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  STATS_T1H_MS,
  STATS_T24H_MS,
  listInteractionHistory,
  listMemorySyncRetries,
  markInteracted,
  selectDueStatSamples,
  type Interaction,
} from "./interactionStore.ts";
import { runStatsTick, shouldRunStatsMain } from "./statsWorker.ts";
import type { SyncInteractionOutcomeResult } from "./memoryOutcome.ts";

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
      syncOutcome: null,
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
      syncOutcome: null,
    });
    assert.equal(result.failed, 1);
    assert.equal(result.sampled, 0);

    const stillDue = selectDueStatSamples(
      await listInteractionHistory({ storePath }),
      now,
    );
    assert.equal(stillDue.length, 1);
  });

  it("invokes outcome sync with patched interaction after sample", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    await markInteracted({
      threadId: "parent",
      author: "@target",
      replyId: "reply1",
      replyUrl: "https://x.com/me/status/reply1",
      nowMs: now - STATS_T1H_MS - 5000,
      storePath,
    });

    const synced: Interaction[] = [];
    const result = await runStatsTick({
      nowMs: now,
      storePath,
      delayMs: 0,
      fetchMetrics: async () => ({
        views: 100,
        likes: 4,
        replies: 1,
        retweets: 0,
      }),
      syncOutcome: async ({ interaction }) => {
        synced.push(interaction);
        return { ok: true, path: "/tmp/note.md", upserted: true };
      },
    });
    assert.equal(result.sampled, 1);
    assert.equal(result.memorySynced, 1);
    assert.equal(result.memorySyncFailed, 0);
    assert.equal(synced.length, 1);
    assert.equal(synced[0]?.stats?.t1h?.views, 100);
    assert.equal(synced[0]?.stats?.t1h?.likes, 4);
  });

  it("memory sync failure does not undo sampled metric", async () => {
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
      fetchMetrics: async () => ({
        views: 50,
        likes: 1,
        replies: 0,
        retweets: 0,
      }),
      syncOutcome: async (): Promise<SyncInteractionOutcomeResult> => ({
        ok: false,
        error: "note missing",
      }),
    });
    assert.equal(result.sampled, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.memorySyncFailed, 1);

    const history = await listInteractionHistory({ storePath });
    assert.equal(history[0]?.stats?.t1h?.views, 50);
  });

  it("does not let burned failures starve newer due samples", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    // Oldest-first due queue: 15 permanently-missing replies + one newer.
    for (let i = 0; i < 15; i++) {
      await markInteracted({
        threadId: `zombie-${i}`,
        author: `@z${i}`,
        replyId: `rz${i}`,
        replyUrl: `https://x.com/me/status/rz${i}`,
        nowMs: now - STATS_T1H_MS - 60_000 - i * 1000,
        storePath,
      });
    }
    await markInteracted({
      threadId: "fresh",
      author: "@fresh",
      replyId: "rfresh",
      replyUrl: "https://x.com/me/status/rfresh",
      nowMs: now - STATS_T1H_MS - 5000,
      storePath,
    });

    for (let t = 0; t < 3; t++) {
      await runStatsTick({
        nowMs: now,
        storePath,
        delayMs: 0,
        syncOutcome: null,
        fetchMetrics: async () => null,
      });
    }

    const fetched: string[] = [];
    const result = await runStatsTick({
      nowMs: now,
      storePath,
      delayMs: 0,
      syncOutcome: null,
      fetchMetrics: async ({ tweetId }) => {
        fetched.push(tweetId);
        return { views: 9, likes: 0, replies: 0, retweets: 0 };
      },
    });
    assert.ok(fetched.includes("rfresh"));
    assert.equal(result.sampled, 1);
    assert.equal(result.failed, 0);
  });

  it("retries a failed memory sync on the next tick and clears the flag", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    await markInteracted({
      threadId: "parent",
      author: "@target",
      replyId: "reply1",
      replyUrl: "https://x.com/me/status/reply1",
      nowMs: now - STATS_T24H_MS - 5000,
      storePath,
    });

    // Both checkpoints are due at once; every projection sync fails.
    const first = await runStatsTick({
      nowMs: now,
      storePath,
      delayMs: 0,
      fetchMetrics: async () => ({
        views: 100,
        likes: 4,
        replies: 1,
        retweets: 0,
      }),
      syncOutcome: async (): Promise<SyncInteractionOutcomeResult> => ({
        ok: false,
        error: "note missing",
      }),
    });
    assert.equal(first.sampled, 2);
    assert.equal(first.memorySyncFailed, 2);

    // Stats exist so no checkpoint is due again, but the projection is flagged.
    assert.equal((await listMemorySyncRetries({ storePath })).length, 1);

    // Next tick retries only the memory sync (no sampling) and succeeds.
    const second = await runStatsTick({
      nowMs: now,
      storePath,
      delayMs: 0,
      syncOutcome: async () => ({ ok: true, path: "/tmp/note.md", upserted: true }),
    });
    assert.equal(second.sampled, 0);
    assert.equal(second.memorySynced, 1);
    assert.equal(second.memorySyncFailed, 0);
    assert.equal((await listMemorySyncRetries({ storePath })).length, 0);
  });
});
