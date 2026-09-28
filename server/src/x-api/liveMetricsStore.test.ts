import { describe, it, before, beforeEach, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import {
  LIVE_METRICS_FAILURE_TTL_MS,
  clearLiveMetricsCacheForTests,
  fetchTweetMetricsMany,
  forgetLiveMetricsMemoryForTests,
} from "./tweetLookup.ts";
import {
  LIVE_METRICS_PRUNE_INTERVAL_MS,
  LIVE_METRICS_ROW_RETENTION_MS,
  pruneLiveMetricsRows,
  readLiveMetricsRows,
  writeLiveMetricsRows,
} from "./liveMetricsStore.ts";
import { getPlatformDb, resetPlatformDbForTests } from "../db.ts";
import { stringRow } from "../platform/unknownValue.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";

const LIVE_METRICS_TTL_MS = 15 * 60 * 1000;

function metricsResponse(ids: string[]): Response {
  return new Response(
    JSON.stringify({
      data: ids.map((id) => ({
        id,
        public_metrics: { impression_count: 100, like_count: 3 },
      })),
    }),
    { status: 200 },
  );
}

function requestedIds(input: string | URL | Request): string[] {
  const url = new URL(input instanceof Request ? input.url : String(input));
  return (url.searchParams.get("ids") ?? "").split(",");
}

function storedIds(): string[] {
  return getPlatformDb()
    .prepare(`SELECT tweet_id FROM live_tweet_metrics ORDER BY tweet_id`)
    .all()
    .map((row) => stringRow(row, "tweet_id").tweet_id);
}

await describe("live metrics persisted in SQLite", async () => {
  const origFetch = globalThis.fetch;
  const prevToken = process.env.X_API_BEARER_TOKEN;
  let warn: ReturnType<typeof mock.method<Console, "warn">>;
  let temp: TempPlatformDb;
  let calls: string[][];

  before(() => {
    temp = openTempPlatformDb("x-live-metrics-store-");
    warn = mock.method(console, "warn", () => {});
  });

  after(() => {
    warn.mock.restore();
    closeTempPlatformDb(temp);
  });

  beforeEach(() => {
    clearLiveMetricsCacheForTests();
    process.env.X_API_BEARER_TOKEN = "test-bearer";
    warn.mock.resetCalls();
    calls = [];
    globalThis.fetch = async (input) => {
      const ids = requestedIds(input);
      calls.push(ids);
      return metricsResponse(ids.filter((id) => id !== "gone"));
    };
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    mock.timers.reset();
    if (prevToken === undefined) delete process.env.X_API_BEARER_TOKEN;
    else process.env.X_API_BEARER_TOKEN = prevToken;
  });

  await it("serves metrics and confirmed absence from SQLite after a restart within the TTL", async () => {
    mock.timers.enable({ apis: ["Date"], now: 5_000_000 });
    const first = await fetchTweetMetricsMany({ tweetIds: ["1", "2", "gone"] });
    assert.equal(first.get("1")?.views, 100);
    assert.equal(calls.length, 1);

    forgetLiveMetricsMemoryForTests();
    mock.timers.tick(LIVE_METRICS_TTL_MS - 1);

    const afterRestart = await fetchTweetMetricsMany({ tweetIds: ["1", "2", "gone"] });
    assert.equal(calls.length, 1);
    assert.deepEqual([...afterRestart.keys()].sort(), ["1", "2"]);
    assert.deepEqual(afterRestart.get("2"), { views: 100, likes: 3 });

    forgetLiveMetricsMemoryForTests();
    const mixed = await fetchTweetMetricsMany({ tweetIds: ["1", "3"] });
    assert.deepEqual(calls[1], ["3"]);
    assert.equal(mixed.get("1")?.views, 100);
    assert.equal(mixed.get("3")?.views, 100);
  });

  await it("refetches rows whose TTL has expired", async () => {
    mock.timers.enable({ apis: ["Date"], now: 5_000_000 });
    await fetchTweetMetricsMany({ tweetIds: ["1", "gone"] });
    forgetLiveMetricsMemoryForTests();
    mock.timers.tick(LIVE_METRICS_TTL_MS);

    const refreshed = await fetchTweetMetricsMany({ tweetIds: ["1", "gone"] });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1]?.sort(), ["1", "gone"]);
    assert.equal(refreshed.get("1")?.views, 100);
  });

  await it("respects a failure marker across a restart, then retries after the failure TTL", async () => {
    mock.timers.enable({ apis: ["Date"], now: 5_000_000 });
    globalThis.fetch = async (input) => {
      calls.push(requestedIds(input));
      return new Response(JSON.stringify({ errors: [{ message: "down" }] }), { status: 503 });
    };
    assert.equal((await fetchTweetMetricsMany({ tweetIds: ["7"] })).size, 0);
    assert.equal(calls.length, 1);

    forgetLiveMetricsMemoryForTests();
    mock.timers.tick(LIVE_METRICS_FAILURE_TTL_MS - 1);
    assert.equal((await fetchTweetMetricsMany({ tweetIds: ["7"] })).size, 0);
    assert.equal(calls.length, 1);

    forgetLiveMetricsMemoryForTests();
    mock.timers.tick(1);
    globalThis.fetch = async (input) => {
      const ids = requestedIds(input);
      calls.push(ids);
      return metricsResponse(ids);
    };
    const retried = await fetchTweetMetricsMany({ tweetIds: ["7"] });
    assert.equal(calls.length, 2);
    assert.equal(retried.get("7")?.views, 100);

    forgetLiveMetricsMemoryForTests();
    assert.equal((await fetchTweetMetricsMany({ tweetIds: ["7"] })).get("7")?.views, 100);
    assert.equal(calls.length, 2);
  });

  await it("prunes rows older than a day at most once per interval", () => {
    const now = 10 * LIVE_METRICS_ROW_RETENTION_MS;
    mock.timers.enable({ apis: ["Date"], now });
    writeLiveMetricsRows([{ tweetId: "fresh", status: "absent", metrics: null, fetchedAt: now }]);
    writeLiveMetricsRows([
      {
        tweetId: "old",
        status: "ok",
        metrics: { views: 1 },
        fetchedAt: now - LIVE_METRICS_ROW_RETENTION_MS - 1,
      },
    ]);
    assert.deepEqual(storedIds(), ["fresh", "old"]);

    mock.timers.tick(LIVE_METRICS_PRUNE_INTERVAL_MS);
    writeLiveMetricsRows([
      { tweetId: "fresh", status: "absent", metrics: null, fetchedAt: Date.now() },
    ]);
    assert.deepEqual(storedIds(), ["fresh"]);
    assert.equal(pruneLiveMetricsRows(Date.now() + 1), 1);
    assert.deepEqual(storedIds(), []);
  });

  await it("reads 100 ids in one query well under 5 ms", () => {
    const now = Date.now();
    const ids = Array.from({ length: 5000 }, (_, i) => String(1_800_000_000_000_000_000n + BigInt(i)));
    writeLiveMetricsRows(
      ids.map((tweetId) => ({
        tweetId,
        status: "ok",
        metrics: { views: 1000, likes: 10, replies: 2, retweets: 1, bookmarks: 0 },
        fetchedAt: now,
      })),
    );
    const wanted = ids.slice(2000, 2100);
    readLiveMetricsRows(wanted, now - LIVE_METRICS_TTL_MS);
    const samples: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      const startedAt = performance.now();
      const rows = readLiveMetricsRows(wanted, now - LIVE_METRICS_TTL_MS);
      samples.push(performance.now() - startedAt);
      assert.equal(rows.length, 100);
    }
    samples.sort((a, b) => a - b);
    assert.ok(samples[Math.floor(samples.length / 2)]! < 5, `median ${samples[25]} ms`);
  });
});

await describe("live metrics with an unusable platform DB", async () => {
  const origFetch = globalThis.fetch;
  const prevToken = process.env.X_API_BEARER_TOKEN;
  let temp: TempPlatformDb;
  let warn: ReturnType<typeof mock.method<Console, "warn">>;

  before(() => {
    temp = openTempPlatformDb("x-live-metrics-broken-");
    clearLiveMetricsCacheForTests();
    resetPlatformDbForTests();
    const blocker = join(temp.dir, "not-a-dir");
    writeFileSync(blocker, "");
    process.env.PLATFORM_DB_PATH = join(blocker, "platform.sqlite");
    warn = mock.method(console, "warn", () => {});
  });

  after(() => {
    warn.mock.restore();
    globalThis.fetch = origFetch;
    if (prevToken === undefined) delete process.env.X_API_BEARER_TOKEN;
    else process.env.X_API_BEARER_TOKEN = prevToken;
    closeTempPlatformDb(temp);
  });

  await it("falls back to X and keeps the in-memory cache", async () => {
    process.env.X_API_BEARER_TOKEN = "test-bearer";
    let calls = 0;
    globalThis.fetch = async (input) => {
      calls += 1;
      return metricsResponse(requestedIds(input));
    };
    const first = await fetchTweetMetricsMany({ tweetIds: ["1"] });
    assert.equal(first.get("1")?.views, 100);
    const second = await fetchTweetMetricsMany({ tweetIds: ["1"] });
    assert.equal(second.get("1")?.views, 100);
    assert.equal(calls, 1);
    assert.ok(
      warn.mock.calls.some((call) => /store unavailable/.test(String(call.arguments[0]))),
    );
  });
});
