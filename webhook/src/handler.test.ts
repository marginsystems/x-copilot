import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "../../server/src/db.ts";
import { getDeskBeats } from "../../server/src/deskBeats.ts";
import { getGamification } from "../../server/src/gamification.ts";
import {
  listInteractionHistory,
  markInteracted,
} from "../../server/src/interactionStore.ts";
import {
  countOwnPostsSince,
  upsertOwnPost,
  watchThread,
} from "../../server/src/ownPostStore.ts";
import type { ParsedPostCreate } from "../../server/src/xActivity.ts";
import { crcResponseToken } from "../../server/src/xActivity.ts";
import {
  getScoutApproachLock,
  setScoutApproachLock,
} from "../../server/src/scoutApproachLock.ts";
import {
  getLastScout,
  saveScoutCache,
} from "../../server/src/scoutCache.ts";
import { markOwnReplyInteracted } from "./handler.ts";
import { createWebhookServer } from "./sidecar.ts";

function post(
  partial: Partial<ParsedPostCreate> = {},
): ParsedPostCreate {
  return {
    eventUuid: partial.eventUuid ?? "event-1",
    xUserId: partial.xUserId ?? "x-user",
    postId: partial.postId ?? "reply-1",
    kind: partial.kind ?? "reply",
    repostTargetId: partial.repostTargetId ?? null,
    text: partial.text ?? "reply",
    postedAt: partial.postedAt ?? "2026-09-04T03:00:00.000Z",
    inReplyToId: partial.inReplyToId === undefined ? "parent-1" : partial.inReplyToId,
    inReplyToUserId:
      partial.inReplyToUserId === undefined ? "target-id" : partial.inReplyToUserId,
    inReplyToUsername:
      partial.inReplyToUsername === undefined ? "target" : partial.inReplyToUsername,
    conversationId:
      partial.conversationId === undefined ? "parent-1" : partial.conversationId,
    authorUsername: partial.authorUsername ?? "pilot",
    metrics: partial.metrics ?? {},
  };
}

describe("own reply interaction capture", () => {
  let dir: string;
  const userId = "user-1";
  const nowMs = Date.parse("2026-09-04T03:00:00.000Z");

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-webhook-interacted-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    process.env.X_API_KEY = "key";
    process.env.X_API_SECRET = "secret";
    const db = getPlatformDb();
    const now = new Date(nowMs).toISOString();
    db.prepare(
      `INSERT INTO users (id, email, created_at, last_login_at)
       VALUES (?, ?, ?, ?)`,
    ).run(userId, "pilot@example.com", now, now);
    db.prepare(
      `INSERT INTO activity_subscriptions
         (user_id, x_user_id, subscription_id, webhook_id, paused_until, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    ).run(userId, "x-user", "sub-1", "webhook-1", now, now);
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    delete process.env.X_API_KEY;
    delete process.env.X_API_SECRET;
    rmSync(dir, { recursive: true, force: true });
  });

  it("marks a watched parent and stamps the scout beat", async () => {
    watchThread({
      userId,
      threadId: "parent-1",
      author: "@watched",
      url: "https://x.com/watched/status/parent-1",
    });

    assert.equal(
      await markOwnReplyInteracted(post(), userId, { nowMs }),
      "scout",
    );
    const [row] = await listInteractionHistory({ userId });
    assert.equal(row?.threadId, "parent-1");
    assert.equal(row?.author, "@watched");
    assert.equal(row?.source, "discovered");
    assert.equal(getDeskBeats({ userId, nowMs }).scoutReplyDone, true);
    const streak = await getGamification({
      userId,
      nowMs,
      gamificationPath: join(dir, "gamification.json"),
    });
    assert.equal(streak.currentStreak >= 1, true);
  });

  it("prunes a matching Scout card but keeps the Approach lock", async () => {
    watchThread({
      userId,
      threadId: "parent-1",
      author: "@watched",
    });
    await saveScoutCache(
      {
        savedAt: new Date(nowMs).toISOString(),
        queries: [],
        threads: [
          {
            id: "parent-1",
            author: "@watched",
            text: "Scout card",
            url: "https://x.com/watched/status/parent-1",
          },
        ],
      },
      { userId },
    );
    setScoutApproachLock(userId, {
      id: "parent-1",
      conversationId: "parent-1",
      inReplyToId: null,
      surface: "reply",
      author: "@scout",
      url: null,
      text: null,
    });

    assert.equal(
      await markOwnReplyInteracted(post(), userId, { nowMs }),
      "scout",
    );
    assert.equal((await getLastScout({ userId }))?.threads.length, 0);
    assert.equal(getScoutApproachLock(userId)?.id, "parent-1");
  });

  it("marks and prunes a repost of the locked Scout card", async () => {
    await saveScoutCache(
      {
        savedAt: new Date(nowMs).toISOString(),
        queries: [],
        threads: [
          {
            id: "card-1",
            conversationId: "root-1",
            author: "@scout",
            text: "Scout repost card",
            url: "https://x.com/scout/status/card-1",
          },
        ],
      },
      { userId },
    );
    setScoutApproachLock(userId, {
      id: "card-1",
      conversationId: "root-1",
      inReplyToId: "parent-1",
      surface: "repost",
      author: "@scout",
      url: "https://x.com/scout/status/card-1",
      text: "Scout repost card",
    });

    assert.equal(
      await markOwnReplyInteracted(
        post({
          postId: "repost-1",
          kind: "repost",
          repostTargetId: "card-1",
          inReplyToId: null,
          inReplyToUserId: null,
          conversationId: "root-1",
        }),
        userId,
        { nowMs },
      ),
      "scout",
    );
    const [row] = await listInteractionHistory({ userId });
    assert.equal(row?.threadId, "card-1");
    assert.equal(row?.replyId, "repost-1");
    assert.equal((await getLastScout({ userId }))?.threads.length, 0);
    assert.equal(getScoutApproachLock(userId)?.id, "card-1");
  });

  it("does not complete a Repost lock for another action", async () => {
    setScoutApproachLock(userId, {
      id: "card-1",
      conversationId: "root-1",
      inReplyToId: null,
      surface: "repost",
      author: "@scout",
      url: null,
      text: null,
    });

    for (const candidate of [
      post({
        postId: "other-repost",
        kind: "repost",
        repostTargetId: "other-card",
        inReplyToId: null,
        conversationId: "root-1",
      }),
      post({
        postId: "quote-1",
        kind: "quote",
        inReplyToId: null,
        conversationId: "root-1",
      }),
      post({
        postId: "original-1",
        kind: "original",
        inReplyToId: null,
        conversationId: null,
      }),
    ]) {
      assert.equal(
        await markOwnReplyInteracted(candidate, userId, { nowMs }),
        "skipped",
      );
    }
    assert.deepEqual(await listInteractionHistory({ userId }), []);
  });

  it("does not complete a reply lock from a repost", async () => {
    setScoutApproachLock(userId, {
      id: "card-1",
      conversationId: "root-1",
      inReplyToId: "parent-1",
      surface: "reply",
      author: "@scout",
      url: null,
      text: null,
    });

    assert.equal(
      await markOwnReplyInteracted(
        post({
          postId: "wrong-repost",
          kind: "repost",
          repostTargetId: "card-1",
          inReplyToId: null,
          conversationId: "root-1",
        }),
        userId,
        { nowMs },
      ),
      "skipped",
    );
    assert.deepEqual(await listInteractionHistory({ userId }), []);
  });

  it("does not complete a repost lock from a reply", async () => {
    watchThread({
      userId,
      threadId: "card-1",
      author: "@scout",
    });
    setScoutApproachLock(userId, {
      id: "card-1",
      conversationId: "root-1",
      inReplyToId: null,
      surface: "repost",
      author: "@scout",
      url: null,
      text: null,
    });

    assert.equal(
      await markOwnReplyInteracted(
        post({
          postId: "wrong-reply",
          kind: "reply",
          inReplyToId: "card-1",
          conversationId: "root-1",
        }),
        userId,
        { nowMs },
      ),
      "organic",
    );
    const [row] = await listInteractionHistory({ userId });
    assert.equal(row?.threadId, "card-1");
    assert.equal(row?.source, "discovered");
  });

  it("completes a legacy reply lock using the migration default", async () => {
    const now = new Date(nowMs).toISOString();
    getPlatformDb()
      .prepare(
        `INSERT INTO scout_approach_locks
           (user_id, card_id, conversation_id, in_reply_to_id, author, url, text, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        "card-1",
        "card-1",
        null,
        "@scout",
        null,
        "Scout card",
        now,
      );

    assert.equal(
      await markOwnReplyInteracted(
        post({ inReplyToId: "card-1", conversationId: "card-1" }),
        userId,
        { nowMs },
      ),
      "scout",
    );
    const [row] = await listInteractionHistory({ userId });
    assert.equal(row?.threadId, "card-1");
  });

  it("marks an unwatched reply and stamps the organic beat", async () => {
    assert.equal(
      await markOwnReplyInteracted(post(), userId, { nowMs }),
      "organic",
    );
    const [row] = await listInteractionHistory({ userId });
    assert.equal(row?.threadId, "parent-1");
    assert.equal(row?.author, "@target");
    assert.equal(row?.replyId, "reply-1");
    assert.equal(getDeskBeats({ userId, nowMs }).organicReplyDone, true);
  });

  it("attributes an OG reply to the locked Scout card", async () => {
    setScoutApproachLock(userId, {
      id: "card-1",
      conversationId: "card-1",
      inReplyToId: null,
      surface: "reply",
      author: "@scout",
      url: "https://x.com/scout/status/card-1",
      text: "Scout card",
    });

    assert.equal(
      await markOwnReplyInteracted(
        post({ inReplyToId: "card-1", conversationId: "card-1" }),
        userId,
        { nowMs },
      ),
      "scout",
    );
    const [row] = await listInteractionHistory({ userId });
    assert.equal(row?.threadId, "card-1");
    assert.equal(row?.author, "@scout");
  });

  it("keeps an unrelated reply in the locked Scout conversation organic", async () => {
    setScoutApproachLock(userId, {
      id: "card-1",
      conversationId: "root-1",
      inReplyToId: "parent-1",
      surface: "reply",
      author: "@scout",
      url: null,
      text: null,
    });

    assert.equal(
      await markOwnReplyInteracted(
        post({
          postId: "child-reply",
          inReplyToId: "other-child",
          conversationId: "root-1",
        }),
        userId,
        { nowMs },
      ),
      "organic",
    );
    const [row] = await listInteractionHistory({ userId });
    assert.equal(row?.threadId, "other-child");
  });

  it("does not steal a reply from a foreign conversation", async () => {
    setScoutApproachLock(userId, {
      id: "card-1",
      conversationId: "root-1",
      inReplyToId: "parent-1",
      surface: "reply",
      author: "@scout",
      url: null,
      text: null,
    });

    assert.equal(
      await markOwnReplyInteracted(
        post({
          postId: "foreign-reply",
          inReplyToId: "foreign-parent",
          conversationId: "foreign-root",
        }),
        userId,
        { nowMs },
      ),
      "organic",
    );
    const [row] = await listInteractionHistory({ userId });
    assert.equal(row?.threadId, "foreign-parent");
    assert.notEqual(row?.threadId, "card-1");
  });

  it("keeps originals out of Interacted", async () => {
    assert.equal(
      await markOwnReplyInteracted(
        post({ kind: "original", inReplyToId: null, conversationId: null }),
        userId,
        { nowMs },
      ),
      "skipped",
    );
    assert.deepEqual(await listInteractionHistory({ userId }), []);
  });

  it("skips a known reply or known thread", async () => {
    await markInteracted({
      threadId: "parent-1",
      author: "@target",
      userId,
      replyId: "known-reply",
      nowMs,
    });

    assert.equal(
      await markOwnReplyInteracted(
        post({ postId: "known-reply", inReplyToId: "other-parent" }),
        userId,
        { nowMs: nowMs + 1 },
      ),
      "skipped",
    );
    assert.equal(
      await markOwnReplyInteracted(
        post({ postId: "new-reply" }),
        userId,
        { nowMs: nowMs + 2 },
      ),
      "skipped",
    );
    assert.equal(
      (await listInteractionHistory({ userId })).length,
      1,
    );
  });

  it("ignores a duplicate event_uuid", async () => {
    const server = createWebhookServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const body = JSON.stringify({
      data: {
        event_uuid: "duplicate-event",
        event_type: "post.create",
        filter: { user_id: "x-user" },
        payload: {
          id: "post-1",
          author_id: "x-user",
          text: "original",
          created_at: "2026-09-04T03:00:00.000Z",
        },
      },
    });
    const send = () =>
      fetch(`http://127.0.0.1:${port}/api/x/activity`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-twitter-webhooks-signature": crcResponseToken(body, "secret"),
        },
        body,
      });

    try {
      const first = await send();
      assert.deepEqual(await first.json(), { ok: true });
      const duplicate = await send();
      assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("removes an own post on signed delete and ignores unknown events", async () => {
    upsertOwnPost({
      parsed: post({ postId: "delete-me", kind: "original", inReplyToId: null }),
      userId,
      tenantId: "local",
    });
    const server = createWebhookServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const send = (body: string) =>
      fetch(`http://127.0.0.1:${port}/api/x/activity`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-twitter-webhooks-signature": crcResponseToken(body, "secret"),
        },
        body,
      });
    const deleted = JSON.stringify({
      data: {
        event_uuid: "delete-event",
        event_type: "post.delete",
        filter: { user_id: "x-user" },
        payload: { id: "delete-me" },
      },
    });
    const unknown = JSON.stringify({
      data: {
        event_uuid: "unknown-event",
        event_type: "profile.update",
        filter: { user_id: "x-user" },
        payload: { id: "delete-me" },
      },
    });

    try {
      assert.deepEqual(await (await send(deleted)).json(), { ok: true });
      assert.equal(countOwnPostsSince(userId, "2000-01-01T00:00:00.000Z"), 0);
      assert.deepEqual(await (await send(deleted)).json(), {
        ok: true,
        duplicate: true,
      });
      assert.deepEqual(await (await send(unknown)).json(), {
        ok: true,
        ignored: true,
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not deduplicate a delete against a create without event_uuid", async () => {
    upsertOwnPost({
      parsed: post({ postId: "fallback-delete", kind: "original", inReplyToId: null }),
      userId,
      tenantId: "local",
    });
    const server = createWebhookServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const send = (body: string) =>
      fetch(`http://127.0.0.1:${port}/api/x/activity`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-twitter-webhooks-signature": crcResponseToken(body, "secret"),
        },
        body,
      });
    const create = JSON.stringify({
      data: {
        event_type: "post.create",
        filter: { user_id: "x-user" },
        payload: { id: "fallback-delete", author_id: "x-user" },
      },
    });
    const deleted = JSON.stringify({
      data: {
        event_type: "post.delete",
        filter: { user_id: "x-user" },
        payload: { id: "fallback-delete" },
      },
    });

    try {
      assert.deepEqual(await (await send(create)).json(), { ok: true });
      assert.deepEqual(await (await send(deleted)).json(), { ok: true });
      assert.equal(countOwnPostsSince(userId, "2000-01-01T00:00:00.000Z"), 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
