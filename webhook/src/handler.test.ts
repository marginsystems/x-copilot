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
