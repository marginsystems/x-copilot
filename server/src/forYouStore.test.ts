import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import {
  SUGGESTION_TTL_MS,
  expireOpenSuggestions,
  hasForYouRunToday,
  insertSuggestions,
  listActiveSuggestions,
  markSuggestion,
  replaceDailySuggestions,
} from "./forYouStore.ts";

describe("forYouStore", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-foryou-"));
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

  it("lists active rows and hides expired or acted ones", () => {
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: now,
      drafts: [
        { kind: "post", why: "best 24h was 2k views", draft: "Ship the recap." },
      ],
    });
    assert.equal(listActiveSuggestions("u1", now + 1000).length, 1);
    assert.equal(
      listActiveSuggestions("u1", now + SUGGESTION_TTL_MS + 1).length,
      0,
    );
  });

  it("replaceDailySuggestions expires leftovers and records the UTC day", () => {
    const morning = Date.parse("2026-08-20T01:00:00.000Z");
    const first = replaceDailySuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: morning,
      drafts: [{ kind: "post", why: "first", draft: "A" }],
    });
    assert.equal(first.length, 1);
    assert.equal(hasForYouRunToday("u1", morning + 3600_000), true);

    const later = morning + 2 * 3600_000;
    replaceDailySuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: later,
      drafts: [{ kind: "post", why: "second", draft: "B" }],
    });
    const active = listActiveSuggestions("u1", later + 1000);
    assert.equal(active.length, 1);
    assert.equal(active[0]?.why, "second");
  });

  it("markSuggestion I posted / skip and expireOpenSuggestions", () => {
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    const [row] = insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: now,
      drafts: [
        { kind: "reply", why: "open thread", targetId: "99", targetUrl: "https://x.com/a/status/99" },
      ],
    });
    assert.ok(row);
    const done = markSuggestion({
      id: row.id,
      userId: "u1",
      status: "done",
      nowMs: now + 1000,
    });
    assert.equal(done?.status, "done");
    assert.equal(listActiveSuggestions("u1", now + 2000).length, 0);

    insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: now,
      drafts: [{ kind: "post", why: "x", draft: "Y" }],
    });
    assert.equal(expireOpenSuggestions("u1", now + 5000), 1);
    assert.equal(listActiveSuggestions("u1", now + 6000).length, 0);
  });
});
