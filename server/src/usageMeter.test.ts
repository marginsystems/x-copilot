import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getPlatformDb,
  resetPlatformDbForTests,
  defaultMigrationsDir,
} from "./db.ts";
import {
  countPostsRead,
  estimatePostReadCostMicros,
  getUsageSummary,
  POST_READ_USD_MICROS,
  recordUsageEvent,
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

  it("counts single tweet lookup", () => {
    assert.equal(
      countPostsRead("/tweets/123", { data: { id: "123", text: "hi" } }),
      1,
    );
  });

  it("ignores non-tweet paths", () => {
    assert.equal(
      countPostsRead("/users/by/username/x", { data: { id: "1" } }),
      0,
    );
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
});
