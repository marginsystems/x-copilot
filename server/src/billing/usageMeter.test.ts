import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { xApiGet } from "../x-api/xApi.ts";
import {
  getPlatformDb,
  resetPlatformDbForTests,
  defaultMigrationsDir,
} from "../db.ts";
import {
  chargeUniquePostReads,
  countPostReadIds,
  countPostsRead,
  describeUsageActivity,
  estimatePostReadCostMicros,
  getUsageSummary,
  POST_READ_USD_MICROS,
  recordUsageEvent,
  toTenantUsageView,
} from "./usageMeter.ts";

describe("countPostsRead", () => {
  it("counts search data arrays", () => {
    assert.equal(
      countPostsRead("/tweets/search/recent", {
        data: [{ id: "1" }, { id: "2" }],
      }),
      2,
    );
  });

  it("counts includes.tweets for search payloads", () => {
    assert.equal(
      countPostsRead("/tweets/search/recent", {
        data: [{ id: "1" }, { id: "2" }],
        includes: { tweets: [{ id: "3" }, { id: "4" }] },
      }),
      4,
    );
  });

  it("dedupes includes.tweets against data", () => {
    assert.equal(
      countPostsRead("/tweets/search/recent", {
        data: [{ id: "1" }],
        includes: { tweets: [{ id: "1" }, { id: "2" }] },
      }),
      2,
    );
  });

  it("counts single tweet lookup", () => {
    assert.equal(
      countPostsRead("/tweets/123", { data: { id: "123", text: "hi" } }),
      1,
    );
    assert.deepEqual(countPostReadIds("/tweets/123", { data: { id: "123" } }), [
      "123",
    ]);
  });

  it("counts unique expansions for a single tweet lookup", () => {
    assert.deepEqual(
      countPostReadIds("/tweets/123", {
        data: { id: "123" },
        includes: { tweets: [{ id: "123" }, { id: "456" }, { id: "456" }] },
      }),
      ["123", "456"],
    );
  });

  it("ignores non-tweet paths", () => {
    assert.equal(
      countPostsRead("/users/by/username/x", { data: { id: "1" } }),
      0,
    );
    for (const path of [
      "/users/by/username/tweets",
      "/users/by/username/tweets_are_great",
      "/tweets/123/liking_users",
      "/tweets/counts/recent",
    ]) {
      assert.equal(countPostsRead(path, { data: [{ id: "1" }] }), 0, path);
    }
  });
});

describe("estimatePostReadCostMicros", () => {
  it("uses $0.005 per post", () => {
    assert.equal(estimatePostReadCostMicros(1), POST_READ_USD_MICROS);
    assert.equal(estimatePostReadCostMicros(10), 10 * POST_READ_USD_MICROS);
  });
});

describe("usage ledger", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-usage-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("charges a post once per UTC day", () => {
    const now = new Date("2026-09-19T23:59:59.999Z");
    assert.equal(
      chargeUniquePostReads(["a", "b", "a"], { tenantId: "t1", now }),
      2,
    );
    assert.equal(
      chargeUniquePostReads(["b", "c"], { tenantId: "t1", now }),
      1,
    );
    assert.equal(
      chargeUniquePostReads(["a", "b"], { tenantId: "t2", now }),
      2,
    );
    assert.equal(
      chargeUniquePostReads(["a", "c"], {
        tenantId: "t1",
        now: new Date("2026-09-20T00:00:00.000Z"),
      }),
      2,
    );
  });

  it("rolls back all daily reads when a dedupe insert fails", () => {
    getPlatformDb().exec(`
      CREATE TRIGGER fail_usage_post_read
      BEFORE INSERT ON usage_post_reads
      WHEN NEW.post_id = 'fail'
      BEGIN
        SELECT RAISE(ABORT, 'forced usage read failure');
      END;
    `);

    assert.throws(() =>
      chargeUniquePostReads(["first", "fail"], {
        tenantId: "t1",
        now: new Date("2026-09-19T23:59:59.999Z"),
      }),
    );
    assert.equal(
      (getPlatformDb()
        .prepare("SELECT COUNT(*) AS n FROM usage_post_reads")
        .get() as { n: number }).n,
      0,
    );
  });

  it("logs only new daily reads and leaves failed/non-tweet requests uncharged", async (t) => {
    const responses = [
      new Response(JSON.stringify({ data: [{ id: "1" }, { id: "2" }] })),
      new Response(JSON.stringify({
        data: [{ id: "2" }, { id: "3" }],
        includes: { tweets: [{ id: "3" }, { id: "4" }, { id: "4" }] },
      })),
      new Response(JSON.stringify({
        data: { id: "4" }, includes: { tweets: [{ id: "4" }, { id: "5" }] },
      })),
      new Response(JSON.stringify({ data: [{ id: "6" }] }), { status: 429 }),
      new Response("not json"),
      new Response(JSON.stringify({ data: { id: "7" } })),
      new Response(JSON.stringify({ data: [{ id: "6" }, { id: "7" }] })),
    ];
    t.mock.method(globalThis, "fetch", async () => responses.shift()!);
    const paths = [
      "/tweets/search/recent", "/tweets/search/recent", "/tweets/4",
      "/tweets/search/recent", "/tweets/search/recent",
      "/users/by/username/tweets", "/tweets/search/recent",
    ];
    for (const path of paths) {
      await xApiGet({ path, creds: { bearerToken: "test", configured: true } });
    }
    assert.deepEqual(
      getPlatformDb().prepare(
        "SELECT posts_read FROM x_api_usage_events ORDER BY rowid",
      ).all(),
      [2, 2, 1, 0, 0, 0, 2].map((posts_read) => ({ posts_read })),
    );
    assert.equal(
      (getPlatformDb().prepare("SELECT COUNT(*) AS n FROM usage_post_reads").get() as { n: number }).n,
      7,
    );
  });

  it("records events and summarizes estimated spend", () => {
    recordUsageEvent({
      path: "/tweets/search/recent",
      status: 200,
      postsRead: 20,
    });
    recordUsageEvent({
      path: "/tweets/search/recent",
      status: 402,
      error: "credits_depleted",
      postsRead: 0,
    });

    const summary = getUsageSummary({ window: "all" });
    assert.equal(summary.calls, 2);
    assert.equal(summary.postsRead, 20);
    assert.equal(summary.estimatedUsd, 0.1);
    assert.equal(summary.creditsDepletedRecent, true);
    assert.equal(summary.recent.length, 2);
    assert.equal(summary.tenantSlug, "local");
  });

  it("excludes non-tweet probe calls from the summary", () => {
    recordUsageEvent({
      path: "/tweets/search/recent",
      status: 200,
      postsRead: 5,
    });
    recordUsageEvent({ path: "/users/by/username/x", status: 200 });
    recordUsageEvent({ path: "/users/123", status: 200 });

    const summary = getUsageSummary({ window: "all" });
    assert.equal(summary.calls, 1);
    assert.equal(summary.postsRead, 5);
    assert.equal(summary.estimatedUsd, 0.025);
    assert.equal(summary.recent.length, 1);
  });

  it("labels Scout search and post lookup", () => {
    assert.equal(
      describeUsageActivity("/tweets/search/recent"),
      "Scout search",
    );
    assert.equal(
      describeUsageActivity("/tweets/search/recent", "credits_depleted"),
      "Scout search (platform read limit)",
    );
    assert.equal(describeUsageActivity("/tweets/1234567890"), "Post lookup");
    assert.equal(
      describeUsageActivity("/internal/for-you-extra"),
      "Approach extras",
    );
  });

  it("walks remaining credits newest-first for this UTC month", () => {
    const older = new Date(Date.now() - 60_000).toISOString();
    const newer = new Date().toISOString();
    recordUsageEvent({
      path: "/tweets/search/recent",
      status: 200,
      postsRead: 20,
      at: older,
    });
    recordUsageEvent({
      path: "/tweets/search/recent",
      status: 200,
      postsRead: 10,
      at: newer,
    });

    const summary = getUsageSummary({ window: "all", creditLimit: 250 });
    assert.equal(summary.monthCreditsUsed, 30);
    assert.equal(summary.remaining, 220);
    assert.equal(summary.recent[0]?.credits, 10);
    assert.equal(summary.recent[0]?.remaining, 220);
    assert.equal(summary.recent[1]?.credits, 20);
    assert.equal(summary.recent[1]?.remaining, 230);
    assert.equal(summary.recent[0]?.activity, "Scout search");
  });

  it("labels post.create deliveries as Post watch", () => {
    assert.equal(describeUsageActivity("/activity/post.create"), "Post watch");
  });

  it("omits remaining on events from a prior UTC month", () => {
    const now = new Date();
    const prior = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15),
    ).toISOString();
    recordUsageEvent({
      path: "/tweets/search/recent",
      status: 200,
      postsRead: 5,
      at: prior,
    });
    recordUsageEvent({
      path: "/tweets/123",
      status: 200,
      postsRead: 1,
    });

    const summary = getUsageSummary({ window: "all", creditLimit: 250 });
    assert.equal(summary.monthCreditsUsed, 1);
    assert.equal(summary.remaining, 249);
    assert.equal(summary.recent[0]?.activity, "Post lookup");
    assert.equal(summary.recent[0]?.remaining, 249);
    assert.equal(summary.recent[1]?.remaining, null);
  });

  it("strips dollar amounts and raw paths from the tenant view", () => {
    recordUsageEvent({
      path: "/tweets/search/recent",
      status: 200,
      postsRead: 8,
    });
    const view = toTenantUsageView(
      getUsageSummary({ window: "all", creditLimit: 250 }),
    );
    assert.equal(view.creditsUsed, 8);
    assert.equal(view.creditLimit, 250);
    assert.equal(view.remaining, 242);
    assert.equal(view.recent[0]?.activity, "Scout search");
    assert.equal(view.recent[0]?.credits, 8);
    assert.equal("estimatedUsd" in view, false);
    assert.equal("postReadUsd" in view, false);
    assert.equal("path" in (view.recent[0] ?? {}), false);
    assert.equal(JSON.stringify(view).includes("$"), false);
    assert.equal(JSON.stringify(view).includes("0.005"), false);
  });
});
