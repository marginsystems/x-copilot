import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backfillOwnPostPostedAt,
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import type { ParsedPostCreate } from "./xActivity.ts";
import {
  analyticsSummary,
  countOwnPostsSince,
  getWatchedThread,
  lastUtcDays,
  listDueOwnPostSamples,
  listOwnPostedAt,
  patchOwnPostSnapshot,
  removeOwnPost,
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
    postedAtFallback: partial.postedAtFallback ?? false,
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
    assert.deepEqual(listOwnPostedAt({ userId, kinds: ["original"] }), [
      "2026-08-15T12:00:00.000Z",
    ]);
    assert.equal(listOwnPostedAt({ userId, kinds: ["original", "quote"] }).length, 1);
    assert.equal(listOwnPostedAt({ userId, kinds: ["reply"] }).length, 1);
  });

  it("removes an own post only for its mapped user and X account", () => {
    upsertOwnPost({
      parsed: post({ postId: "delete-me" }),
      userId: "user-1",
      tenantId: "tenant-1",
    });
    assert.equal(
      removeOwnPost({
        postId: "delete-me",
        userId: "other",
        xUserId: "99",
      }),
      false,
    );
    assert.equal(
      removeOwnPost({
        postId: "delete-me",
        userId: "user-1",
        xUserId: "99",
      }),
      true,
    );
    assert.equal(countOwnPostsSince("user-1", "2000-01-01T00:00:00.000Z"), 0);
  });

  it("plots a continuous zero-filled 30-day UTC window, not just posting days", () => {
    const userId = "user-series";
    const now = new Date("2026-08-24T15:00:00.000Z");
    upsertOwnPost({
      parsed: post({ postId: "a", postedAt: "2026-08-17T09:00:00.000Z" }),
      userId,
      tenantId: "t",
    });
    upsertOwnPost({
      parsed: post({ postId: "b", postedAt: "2026-08-22T09:00:00.000Z" }),
      userId,
      tenantId: "t",
    });
    // Older than the window: stays in totals, drops off the chart.
    upsertOwnPost({
      parsed: post({ postId: "old", postedAt: "2026-06-01T09:00:00.000Z" }),
      userId,
      tenantId: "t",
    });
    const summary = analyticsSummary(userId, now);
    assert.equal(summary.totals.posts, 3);
    assert.equal(summary.series.length, 30);
    assert.equal(summary.series[0]?.day, "2026-07-26");
    assert.equal(summary.series[29]?.day, "2026-08-24");
    const byDay = new Map(summary.series.map((d) => [d.day, d]));
    assert.equal(byDay.get("2026-08-17")?.posts, 1);
    assert.equal(byDay.get("2026-08-17")?.views, 10);
    assert.equal(byDay.get("2026-08-22")?.posts, 1);
    // A day with no posts is present and zero, so the x-axis is a real window.
    assert.equal(byDay.get("2026-08-20")?.posts, 0);
    assert.equal(byDay.get("2026-08-20")?.views, 0);
    assert.equal(byDay.has("2026-06-01"), false);
  });

  it("lastUtcDays spans month boundaries in UTC", () => {
    const days = lastUtcDays(3, new Date("2026-08-01T00:30:00.000Z"));
    assert.deepEqual(days, ["2026-07-30", "2026-07-31", "2026-08-01"]);
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

  it("backfills legacy raw created_at posted_at rows to ISO so they become due", () => {
    const db = getPlatformDb();
    db.prepare(
      `INSERT INTO own_posts (
         id, user_id, tenant_id, x_user_id, kind, text, posted_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "legacy",
      "u",
      "t",
      "99",
      "original",
      "old post",
      "Sat Jul 25 00:00:00 +0000 2026",
      "2026-08-01T00:00:00.000Z",
    );
    assert.equal(
      listDueOwnPostSamples({ limit: 10 }).some((d) => d.postId === "legacy"),
      false,
    );
    backfillOwnPostPostedAt(db);
    const row = db
      .prepare(`SELECT posted_at FROM own_posts WHERE id = ?`)
      .get("legacy") as { posted_at: string };
    assert.equal(row.posted_at, "2026-07-25T00:00:00.000Z");
    assert.ok(
      listDueOwnPostSamples({ limit: 10 }).some((d) => d.postId === "legacy"),
    );
  });

  it("leaves unparseable posted_at rows unchanged during backfill", () => {
    const db = getPlatformDb();
    db.prepare(
      `INSERT INTO own_posts (
         id, user_id, tenant_id, x_user_id, kind, text, posted_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "unparseable",
      "u",
      "t",
      "99",
      "original",
      "garbled",
      "not-a-real-timestamp",
      "2026-08-01T00:00:00.000Z",
    );
    backfillOwnPostPostedAt(db);
    const row = db
      .prepare(`SELECT posted_at FROM own_posts WHERE id = ?`)
      .get("unparseable") as { posted_at: string };
    assert.equal(row.posted_at, "not-a-real-timestamp");
  });

  it("keeps a correct stored posted_at and only repairs non-ISO values on re-ingest", () => {
    // A re-ingest must not clobber a good ISO timestamp with a fallback "now"
    // (parsePostCreateEvent / replyToOwnPost emit `now` when created_at is unknown).
    assert.equal(
      upsertOwnPost({
        parsed: post({ postId: "kept", postedAt: "2026-07-25T00:00:00.000Z" }),
        userId: "u",
        tenantId: "t",
      }),
      true,
    );
    assert.equal(
      upsertOwnPost({
        parsed: post({
          postId: "kept",
          postedAt: new Date().toISOString(),
          postedAtFallback: true,
        }),
        userId: "u",
        tenantId: "t",
      }),
      false,
    );
    const kept = getPlatformDb()
      .prepare(`SELECT posted_at FROM own_posts WHERE id = ?`)
      .get("kept") as { posted_at: string };
    assert.equal(kept.posted_at, "2026-07-25T00:00:00.000Z");

    // A legacy raw stored value is still repaired to the incoming ISO value.
    getPlatformDb()
      .prepare(
        `INSERT INTO own_posts (
           id, user_id, tenant_id, x_user_id, kind, text, posted_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "legacy-conflict",
        "u",
        "t",
        "99",
        "original",
        "old post",
        "Sat Jul 25 00:00:00 +0000 2026",
        "2026-08-01T00:00:00.000Z",
      );
    assert.equal(
      upsertOwnPost({
        parsed: post({
          postId: "legacy-conflict",
          postedAt: "2026-07-25T00:00:00.000Z",
        }),
        userId: "u",
        tenantId: "t",
      }),
      false,
    );
    const repaired = getPlatformDb()
      .prepare(`SELECT posted_at FROM own_posts WHERE id = ?`)
      .get("legacy-conflict") as { posted_at: string };
    assert.equal(repaired.posted_at, "2026-07-25T00:00:00.000Z");
  });

  it("lets a real created_at correct a stored fallback now on re-ingest", () => {
    // A row first inserted with the fallback timestamp (created_at unknown) must
    // not keep that `now` forever once the true created_at arrives.
    assert.equal(
      upsertOwnPost({
        parsed: post({
          postId: "corrected",
          postedAt: new Date().toISOString(),
          postedAtFallback: true,
        }),
        userId: "u",
        tenantId: "t",
      }),
      true,
    );
    assert.equal(
      upsertOwnPost({
        parsed: post({
          postId: "corrected",
          postedAt: "2026-07-25T00:00:00.000Z",
        }),
        userId: "u",
        tenantId: "t",
      }),
      false,
    );
    const row = getPlatformDb()
      .prepare(`SELECT posted_at FROM own_posts WHERE id = ?`)
      .get("corrected") as { posted_at: string };
    assert.equal(row.posted_at, "2026-07-25T00:00:00.000Z");
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
