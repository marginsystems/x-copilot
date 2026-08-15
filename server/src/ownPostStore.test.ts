import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import type { ParsedPostCreate } from "./xActivity.ts";
import {
  analyticsSummary,
  countOwnPostsSince,
  getWatchedThread,
  listDueOwnPostSamples,
  patchOwnPostSnapshot,
  rememberActivityEvent,
  seenActivityEvent,
  startOfUtcDayIso,
  upsertOwnPost,
  watchThread,
} from "./ownPostStore.ts";

function post(partial: Partial<ParsedPostCreate> & { postId: string }): ParsedPostCreate {
  return {
    eventUuid: partial.eventUuid ?? `evt-${partial.postId}`,
    xUserId: partial.xUserId ?? "99",
    postId: partial.postId,
    kind: partial.kind ?? "original",
    text: partial.text ?? "hello",
    postedAt: partial.postedAt ?? "2026-08-15T12:00:00.000Z",
    inReplyToId: partial.inReplyToId ?? null,
    inReplyToUserId: partial.inReplyToUserId ?? null,
    conversationId: partial.conversationId ?? null,
    authorUsername: partial.authorUsername ?? "desk",
    metrics: partial.metrics ?? {
      views: 10,
      likes: 2,
      replies: 1,
      retweets: 0,
      bookmarks: 3,
    },
  };
}

describe("ownPostStore", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-own-"));
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

  it("upserts originals and replies the same and snapshots later metrics", () => {
    const userId = "user-1";
    const tenantId = "tenant-1";
    assert.equal(
      upsertOwnPost({
        parsed: post({ postId: "1", kind: "original" }),
        userId,
        tenantId,
      }),
      true,
    );
    assert.equal(
      upsertOwnPost({
        parsed: post({
          postId: "2",
          kind: "reply",
          inReplyToId: "9",
          postedAt: "2026-08-15T13:00:00.000Z",
        }),
        userId,
        tenantId,
      }),
      true,
    );
    assert.equal(
      upsertOwnPost({
        parsed: post({ postId: "1", kind: "original", text: "hello again" }),
        userId,
        tenantId,
      }),
      false,
    );
    assert.equal(countOwnPostsSince(userId, startOfUtcDayIso(new Date("2026-08-15T18:00:00Z"))), 2);

    patchOwnPostSnapshot("1", "t1h", { views: 40, likes: 8, bookmarks: 5 });
    const summary = analyticsSummary(userId);
    assert.equal(summary.totals.posts, 2);
    assert.equal(summary.totals.originals, 1);
    assert.equal(summary.totals.replies, 1);
    assert.equal(summary.totals.views, 50);
    assert.equal(summary.totals.likes, 10);
    assert.equal(summary.totals.bookmarks, 8);
    assert.equal(summary.top[0]?.id, "1");
  });

  it("lists due 1h then 24h samples", () => {
    const postedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    upsertOwnPost({
      parsed: post({ postId: "old", postedAt }),
      userId: "u",
      tenantId: "t",
    });
    const due = listDueOwnPostSamples({ limit: 10 });
    assert.equal(due.length, 1);
    assert.equal(due[0]?.checkpoint, "t1h");
    patchOwnPostSnapshot("old", "t1h", { views: 12 });
    const due24 = listDueOwnPostSamples({ limit: 10 });
    assert.equal(due24[0]?.checkpoint, "t24h");
  });

  it("round-robins due samples across tenants so a high-volume tenant cannot starve others", () => {
    const now = Date.now();
    // Heavy tenant backlogs many oldest rows; light tenant has a newer due row.
    for (let i = 0; i < 20; i++) {
      upsertOwnPost({
        parsed: post({
          postId: `heavy-${i}`,
          postedAt: new Date(now - (30 - i) * 60 * 60 * 1000).toISOString(),
        }),
        userId: "u-heavy",
        tenantId: "heavy",
      });
    }
    upsertOwnPost({
      parsed: post({
        postId: "light-1",
        postedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      }),
      userId: "u-light",
      tenantId: "light",
    });
    const due = listDueOwnPostSamples({ limit: 5 });
    assert.ok(
      due.some((d) => d.tenantId === "light"),
      "light tenant's newer post must appear despite heavy tenant's oldest-first backlog",
    );
  });

  it("dedupes activity event ids and watches threads", () => {
    assert.equal(seenActivityEvent("e1"), false);
    rememberActivityEvent("e1");
    assert.equal(seenActivityEvent("e1"), true);
    watchThread({
      userId: "u",
      threadId: "tid",
      author: "alice",
      url: "https://x.com/alice/status/tid",
    });
    const watched = getWatchedThread("u", "tid");
    assert.equal(watched?.author, "alice");
  });
});
