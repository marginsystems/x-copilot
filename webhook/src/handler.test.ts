import assert from "node:assert/strict";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "../../server/src/db.ts";
import { getDeskBeats } from "../../server/src/desk/deskBeats.ts";
import { getGamification } from "../../server/src/desk/gamification.ts";
import {
  listInteractionHistory,
  markInteracted,
} from "../../server/src/desk/interactionStore.ts";
import {
  countOwnPostsSince,
  upsertOwnPost,
  watchThread,
} from "../../server/src/desk/ownPostStore.ts";
import { resetInteractionMemoryProjectionForTests } from "../../server/src/memory/interactionMemoryProjection.ts";
import {
  buildInteractionNotePath,
  writeInteractionMemory,
} from "../../server/src/memory/knowledgeMemory.ts";
import type { ParsedPostCreate } from "../../server/src/x-api/xActivity.ts";
import { crcResponseToken } from "../../server/src/x-api/xActivity.ts";
import {
  getScoutApproachLock,
  setScoutApproachLock,
} from "../../server/src/scout/scoutApproachLock.ts";
import {
  getLastScout,
  saveScoutCache,
} from "../../server/src/scout/scoutCache.ts";
import {
  markOwnReplyInteracted,
  resetWebhookMemoryProjectionForTests,
} from "./handler.ts";
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

function knowledgeRootFor(dir: string): string {
  return join(dir, "knowledge");
}

function notePathFor(
  dir: string,
  threadId: string,
  at = "2026-09-04T03:00:00.000Z",
  owner = "user-1",
): string {
  return buildInteractionNotePath({
    userId: owner,
    threadId,
    interactedAt: at,
    knowledgeRoot: knowledgeRootFor(dir),
  });
}

function noteNameFor(threadId: string, at?: string, owner?: string): string {
  return basename(notePathFor("/x", threadId, at, owner));
}

async function readNote(
  dir: string,
  threadId: string,
  at?: string,
  owner?: string,
): Promise<string> {
  return readFile(notePathFor(dir, threadId, at, owner), "utf8");
}

function listedNotes(dir: string): string[] {
  try {
    return readdirSync(join(dir, "knowledge", "interactions")).filter((name) =>
      name.endsWith(".md"),
    );
  } catch {
    return [];
  }
}

await describe("own reply interaction capture", async () => {
  let dir: string;
  const userId = "user-1";
  const nowMs = Date.parse("2026-09-04T03:00:00.000Z");

  beforeEach(() => {
    resetPlatformDbForTests();
    resetInteractionMemoryProjectionForTests();
    dir = mkdtempSync(join(tmpdir(), "x-webhook-interacted-"));
    resetWebhookMemoryProjectionForTests({
      knowledgeRoot: knowledgeRootFor(dir),
      upsertMemory: false,
    });
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
    resetInteractionMemoryProjectionForTests();
    resetWebhookMemoryProjectionForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    delete process.env.X_API_KEY;
    delete process.env.X_API_SECRET;
    rmSync(dir, { recursive: true, force: true });
  });

  await it("marks a watched parent and stamps the scout beat", async () => {
    watchThread({
      userId,
      threadId: "parent-1",
      author: "@watched",
      url: "https://x.com/watched/status/parent-1",
      text: "Watched parent post",
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
    const note = await readNote(dir, "parent-1");
    assert.match(note, /userId: "user-1"/);
    assert.match(note, /source: discovered/);
    assert.match(note, /Watched parent post/);
    assert.match(note, /## Reply[\s\S]*\nreply\n/);
  });

  await it("marks a reply to a locked Suggested target as scout", async () => {
    setScoutApproachLock(userId, {
      id: "parent-1",
      conversationId: "parent-1",
      inReplyToId: "parent-1",
      surface: "reply",
      author: "@target",
      url: "https://x.com/target/status/parent-1",
      text: "Suggested reply draft",
    });

    assert.equal(
      await markOwnReplyInteracted(post(), userId, { nowMs }),
      "scout",
    );
    const [row] = await listInteractionHistory({ userId });
    assert.equal(row?.threadId, "parent-1");
    assert.equal(row?.inReplyToId, "parent-1");
    assert.equal(row?.author, "@target");
    const note = await readNote(dir, "parent-1");
    assert.match(note, /userId: "user-1"/);
    assert.match(note, /Suggested reply draft/);
    assert.match(note, /## Reply[\s\S]*\nreply\n/);
  });

  await it("prunes a matching Scout card but keeps the Approach lock", async () => {
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

  await it("does not complete a reply lock from a repost", async () => {
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

  await it("completes a stale repost lock from a reply", async () => {
    const now = new Date(nowMs).toISOString();
    getPlatformDb()
      .prepare(
        `INSERT INTO scout_approach_locks
           (user_id, card_id, conversation_id, in_reply_to_id, surface, author, url, text, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        "card-1",
        "root-1",
        null,
        "repost",
        "@scout",
        null,
        null,
        now,
      );

    assert.equal(
      await markOwnReplyInteracted(
        post({ inReplyToId: "card-1", conversationId: "root-1" }),
        userId,
        { nowMs },
      ),
      "scout",
    );
    const [row] = await listInteractionHistory({ userId });
    assert.equal(row?.threadId, "card-1");
    assert.equal(row?.replyId, "reply-1");
  });

  await it("defaults a surface-less lock to reply", () => {
    setScoutApproachLock(userId, {
      id: "card-1",
      conversationId: "card-1",
      inReplyToId: null,
      surface: null,
      author: "@scout",
      url: null,
      text: null,
    });

    assert.equal(getScoutApproachLock(userId)?.surface, "reply");
  });

  await it("completes a legacy reply lock using the migration default", async () => {
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

  await it("marks an unwatched reply and stamps the organic beat", async () => {
    assert.equal(
      await markOwnReplyInteracted(post(), userId, { nowMs }),
      "organic",
    );
    const [row] = await listInteractionHistory({ userId });
    assert.equal(row?.threadId, "parent-1");
    assert.equal(row?.author, "@target");
    assert.equal(row?.replyId, "reply-1");
    assert.equal(getDeskBeats({ userId, nowMs }).organicReplyDone, true);
    const note = await readNote(dir, "parent-1");
    assert.match(note, /userId: "user-1"/);
    assert.match(note, /\(no thread text\)/);
    assert.match(note, /## Reply[\s\S]*\nreply\n/);
  });

  await it("attributes an OG reply to the locked Scout card", async () => {
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

  await it("keeps an unrelated reply in the locked Scout conversation organic", async () => {
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

  await it("does not steal a reply from a foreign conversation", async () => {
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

  await it("keeps originals out of Interacted", async () => {
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

  await it("skips a known reply and records another reply in the same thread", async () => {
    await markInteracted({
      threadId: "parent-1",
      author: "@target",
      userId,
      replyId: "known-reply",
      nowMs,
    });
    const xpBefore = await getGamification({ userId, nowMs });

    assert.equal(
      await markOwnReplyInteracted(
        post({ postId: "known-reply", inReplyToId: "other-parent" }),
        userId,
        { nowMs: nowMs + 1 },
      ),
      "skipped",
    );
    const repaired = await readNote(dir, "parent-1");
    assert.match(repaired, /userId: "user-1"/);
    assert.match(repaired, /## Reply[\s\S]*\nreply\n/);
    assert.equal(
      await markOwnReplyInteracted(
        post({ postId: "new-reply" }),
        userId,
        { nowMs: nowMs + 2 },
      ),
      "organic",
    );
    assert.equal(
      (await listInteractionHistory({ userId })).length,
      1,
    );
    assert.deepEqual(listedNotes(dir), [noteNameFor("parent-1")]);
    const xpAfter = await getGamification({ userId, nowMs: nowMs + 2 });
    assert.equal(xpAfter.lifetimeXp, xpBefore.lifetimeXp);
  });

  await it("keys webhook memory by reply time across a UTC date boundary", async () => {
    const postedAt = "2026-09-04T23:59:55.000Z";
    const deliveredAt = Date.parse("2026-09-05T00:00:05.000Z");

    assert.equal(
      await markOwnReplyInteracted(
        post({ postedAt }),
        userId,
        { nowMs: deliveredAt },
      ),
      "organic",
    );

    assert.deepEqual(listedNotes(dir), [noteNameFor("parent-1", postedAt)]);
    assert.match(listedNotes(dir)[0]!, /^2026-09-04-u[0-9a-f]{64}-h[0-9a-f]{64}\.md$/);
  });

  await it("does not overwrite an existing manual note on the known path", async () => {
    await markInteracted({
      threadId: "parent-1",
      author: "@target",
      userId,
      replyId: "known-reply",
      nowMs,
    });
    await writeInteractionMemory({
      threadId: "parent-1",
      author: "@target",
      reply: "manual reply",
      source: "manual",
      userId,
      text: "parent context",
      opAuthor: "@target",
      opText: "richer OP context",
      agenda: "follow up",
      baitScore: 7,
      engage: "high",
      flags: ["important"],
      intent: "reply",
      reason: "manual triage",
      interactedAt: new Date(nowMs).toISOString(),
      knowledgeRoot: knowledgeRootFor(dir),
    });

    assert.equal(
      await markOwnReplyInteracted(
        post({ postId: "known-reply", text: "webhook retry" }),
        userId,
        { nowMs: nowMs + 1 },
      ),
      "skipped",
    );
    const note = await readNote(dir, "parent-1");
    assert.match(note, /source: manual/);
    assert.match(note, /richer OP context/);
    assert.match(note, /agenda: "follow up"/);
    assert.match(note, /manual triage/);
    assert.match(note, /manual reply/);
    assert.doesNotMatch(note, /webhook retry/);
  });

  await it("repairs its own note when another user's note shares the thread and date", async () => {
    await markInteracted({
      threadId: "parent-1",
      author: "@target",
      userId,
      replyId: "known-reply",
      nowMs,
    });
    const foreign = await writeInteractionMemory({
      threadId: "parent-1",
      author: "@target",
      reply: "foreign reply",
      userId: "user-other",
      interactedAt: new Date(nowMs).toISOString(),
      knowledgeRoot: knowledgeRootFor(dir),
    });
    let writes = 0;
    resetInteractionMemoryProjectionForTests({
      writeNote: async (input) => {
        writes += 1;
        return writeInteractionMemory(input);
      },
    });

    assert.equal(
      await markOwnReplyInteracted(
        post({ postId: "known-reply" }),
        userId,
        { nowMs: nowMs + 1 },
      ),
      "skipped",
    );
    assert.equal(writes, 1);
    const own = await readNote(dir, "parent-1");
    assert.match(own, /userId: "user-1"/);
    assert.match(own, /## Reply[\s\S]*\nreply\n/);
    const kept = await readFile(foreign.path, "utf8");
    assert.match(kept, /userId: "user-other"/);
    assert.match(kept, /foreign reply/);
    assert.equal(listedNotes(dir).length, 2);
  });

  await it("repairs when the known path holds an unowned legacy note or a note without reply text", async () => {
    await markInteracted({
      threadId: "parent-1",
      author: "@target",
      userId,
      replyId: "known-reply",
      nowMs,
    });
    const legacyDir = join(knowledgeRootFor(dir), "interactions");
    mkdirSync(legacyDir, { recursive: true });
    const legacyPath = join(legacyDir, "2026-09-04-parent-1.md");
    const unowned = `---\ntype: interaction\nthreadId: "parent-1"\ninteractedAt: "${new Date(nowMs).toISOString()}"\n---\n\n## Reply\n\nunowned legacy\n`;
    writeFileSync(legacyPath, unowned, "utf8");
    let writes = 0;
    resetInteractionMemoryProjectionForTests({
      writeNote: async (input) => {
        writes += 1;
        return writeInteractionMemory(input);
      },
    });
    assert.equal(
      await markOwnReplyInteracted(post({ postId: "known-reply" }), userId, {
        nowMs: nowMs + 1,
      }),
      "skipped",
    );
    assert.equal(writes, 1);
    assert.equal(readFileSync(legacyPath, "utf8"), unowned);
    assert.match(await readNote(dir, "parent-1"), /userId: "user-1"/);

    // A verified owned note with reply text suppresses further repair...
    assert.equal(
      await markOwnReplyInteracted(post({ postId: "known-reply" }), userId, {
        nowMs: nowMs + 2,
      }),
      "skipped",
    );
    assert.equal(writes, 1);
    // ...but the same discovered note without reply text does not.
    writeFileSync(
      notePathFor(dir, "parent-1"),
      `---\ntype: interaction\nthreadId: "parent-1"\nuserId: "user-1"\ninteractedAt: "${new Date(nowMs).toISOString()}"\nsource: discovered\n---\n\n## Post\n\nno reply\n`,
      "utf8",
    );
    assert.equal(
      await markOwnReplyInteracted(post({ postId: "known-reply" }), userId, {
        nowMs: nowMs + 3,
      }),
      "skipped",
    );
    assert.equal(writes, 2);
    assert.match(await readNote(dir, "parent-1"), /## Reply[\s\S]*\nreply\n/);
  });

  await it("repairs one note for a known watched reply without extra XP", async () => {
    watchThread({
      userId,
      threadId: "parent-1",
      author: "@watched",
      url: "https://x.com/watched/status/parent-1",
      text: "Watched parent post",
    });
    assert.equal(
      await markOwnReplyInteracted(post(), userId, { nowMs }),
      "scout",
    );
    const xpAfterFirst = await getGamification({ userId, nowMs });
    assert.equal(
      await markOwnReplyInteracted(post(), userId, { nowMs: nowMs + 1 }),
      "skipped",
    );
    assert.equal((await listInteractionHistory({ userId })).length, 1);
    assert.deepEqual(listedNotes(dir), [noteNameFor("parent-1")]);
    const note = await readNote(dir, "parent-1");
    assert.match(note, /Watched parent post/);
    assert.match(note, /## Reply[\s\S]*\nreply\n/);
    const xpAfterRepair = await getGamification({ userId, nowMs: nowMs + 1 });
    assert.equal(xpAfterRepair.lifetimeXp, xpAfterFirst.lifetimeXp);
  });

  await it("keeps the mark when confirmed-reply memory cannot be saved", async () => {
    resetInteractionMemoryProjectionForTests({
      writeNote: async () => {
        throw new Error("EACCES: injected filesystem failure");
      },
    });
    watchThread({
      userId,
      threadId: "parent-1",
      author: "@watched",
      url: "https://x.com/watched/status/parent-1",
      text: "Watched parent post",
    });
    assert.equal(
      await markOwnReplyInteracted(post(), userId, { nowMs }),
      "scout",
    );
    const [row] = await listInteractionHistory({ userId });
    assert.equal(row?.replyId, "reply-1");
    assert.equal(getDeskBeats({ userId, nowMs }).scoutReplyDone, true);
    await assert.rejects(() => readNote(dir, "parent-1"), /ENOENT/);
  });

  await it("keeps the mark when scout evidence context cannot be read", async () => {
    getPlatformDb().prepare("DROP TABLE scout_target_context").run();
    watchThread({
      userId,
      threadId: "parent-1",
      author: "@watched",
      url: "https://x.com/watched/status/parent-1",
      text: "Watched parent post",
    });

    assert.equal(
      await markOwnReplyInteracted(post(), userId, { nowMs }),
      "scout",
    );
    const [row] = await listInteractionHistory({ userId });
    assert.equal(row?.replyId, "reply-1");
  });

  await it("keeps a saved note when MiniLM upsert is unavailable", async () => {
    resetWebhookMemoryProjectionForTests({
      knowledgeRoot: knowledgeRootFor(dir),
      awaitUpsert: true,
    });
    resetInteractionMemoryProjectionForTests({
      upsertNote: async (notePath) => ({
        ok: false,
        path: notePath,
        error: "injected index failure",
      }),
    });
    watchThread({
      userId,
      threadId: "parent-1",
      author: "@watched",
      url: "https://x.com/watched/status/parent-1",
      text: "Watched parent post",
    });
    assert.equal(
      await markOwnReplyInteracted(post(), userId, { nowMs }),
      "scout",
    );
    const note = await readNote(dir, "parent-1");
    assert.match(note, /Watched parent post/);
    assert.match(note, /## Reply[\s\S]*\nreply\n/);
    assert.equal((await listInteractionHistory({ userId })).length, 1);
  });

  await it("explains only the first forbidden desk wake without retrying", async (t) => {
    const original = globalThis.fetch;
    let wakeCalls = 0;
    t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (String(input).includes("/api/desk/events/wake")) {
        wakeCalls += 1;
        return new Response(null, { status: 403 });
      }
      return original(input, init);
    });
    const warn = t.mock.method(console, "warn", () => {});
    const server = createWebhookServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    try {
      for (const id of ["wake-forbidden-1", "wake-forbidden-2"]) {
        const body = JSON.stringify({
          data: {
            event_uuid: id,
            event_type: "post.create",
            filter: { user_id: "x-user" },
            payload: {
              id,
              author_id: "x-user",
              text: "original",
              created_at: "2026-09-04T03:00:00.000Z",
            },
          },
        });
        const res = await fetch(`http://127.0.0.1:${address.port}/api/x/activity`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-twitter-webhooks-signature": crcResponseToken(body, "secret"),
          },
          body,
        });
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { ok: true });
      }
      assert.equal(wakeCalls, 2);
      assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [
        ["[xaa] desk wake soft-fail", 403,
          "API and webhook DESK_EVENTS_SECRET values disagree or are empty."],
        ["[xaa] desk wake soft-fail", 403],
      ]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  await it("ignores a duplicate event_uuid", async () => {
    const server = createWebhookServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const port = address.port;
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

  await it("does not remake or reaward a duplicate reply event", async () => {
    watchThread({
      userId,
      threadId: "parent-1",
      author: "@watched",
      url: "https://x.com/watched/status/parent-1",
      text: "Watched parent post",
    });
    const server = createWebhookServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const port = address.port;
    const body = JSON.stringify({
      data: {
        event_uuid: "reply-duplicate-event",
        event_type: "post.create",
        filter: { user_id: "x-user" },
        payload: {
          id: "reply-dup",
          author_id: "x-user",
          text: "Confirmed webhook reply",
          created_at: "2026-09-04T03:00:00.000Z",
          conversation_id: "parent-1",
          in_reply_to_user_id: "target-id",
          in_reply_to_tweet_id: "parent-1",
          referenced_tweets: [{ type: "replied_to", id: "parent-1" }],
        },
        includes: {
          users: [
            { id: "x-user", username: "pilot" },
            { id: "target-id", username: "watched" },
          ],
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
      const xpAfterFirst = await getGamification({ userId, nowMs });
      const notesAfterFirst = listedNotes(dir);
      assert.equal(notesAfterFirst.length, 1);
      const note = await readFile(
        join(dir, "knowledge", "interactions", notesAfterFirst[0]!),
        "utf8",
      );
      assert.match(note, /Confirmed webhook reply/);
      assert.match(note, /Watched parent post/);
      const duplicate = await send();
      assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true });
      assert.equal((await listInteractionHistory({ userId })).length, 1);
      assert.deepEqual(listedNotes(dir), notesAfterFirst);
      const xpAfterDup = await getGamification({ userId, nowMs });
      assert.equal(xpAfterDup.lifetimeXp, xpAfterFirst.lifetimeXp);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  await it("removes an own post on signed delete and ignores unknown events", async () => {
    upsertOwnPost({
      parsed: post({ postId: "delete-me", kind: "original", inReplyToId: null }),
      userId,
      tenantId: "local",
    });
    const server = createWebhookServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const port = address.port;
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

  await it("does not deduplicate a delete against a create without event_uuid", async () => {
    upsertOwnPost({
      parsed: post({ postId: "fallback-delete", kind: "original", inReplyToId: null }),
      userId,
      tenantId: "local",
    });
    const server = createWebhookServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const port = address.port;
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

  await it("still 200s when the desk wake fetch throws", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      if (url.includes("/api/desk/events/wake")) {
        throw new Error("wake down");
      }
      return original(input, init);
    }) as typeof fetch;
    const server = createWebhookServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const port = address.port;
    const body = JSON.stringify({
      data: {
        event_uuid: "wake-fail",
        event_type: "post.create",
        filter: { user_id: "x-user" },
        payload: {
          id: "wake-fail-post",
          author_id: "x-user",
          text: "original",
          created_at: "2026-09-04T03:00:00.000Z",
        },
      },
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/x/activity`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-twitter-webhooks-signature": crcResponseToken(body, "secret"),
        },
        body,
      });
      assert.deepEqual(await res.json(), { ok: true });
    } finally {
      globalThis.fetch = original;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
