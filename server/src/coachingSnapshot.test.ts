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
  buildCoachingSnapshot,
  loadInstrumentTimes,
  originalsTodayCount,
} from "./coachingSnapshot.ts";
import { listMissionsWithProgress } from "./dailyMissions.ts";
import { insertSuggestions, markSuggestion } from "./forYouStore.ts";
import { markInteracted } from "./interactionStore.ts";
import { upsertOwnPost } from "./ownPostStore.ts";
import type { ParsedPostCreate } from "./xActivity.ts";
import { recordDeskPost } from "./xPostLimits.ts";

const NOW_MS = Date.parse("2026-08-27T12:00:00.000Z");

describe("originalsTodayCount", () => {
  it("takes the strongest of own_posts, desk originals, and confirmed OG cards", () => {
    assert.equal(originalsTodayCount(0, 0, 0), 0);
    assert.equal(originalsTodayCount(0, 0, 1), 1);
    assert.equal(originalsTodayCount(0, 1, 0), 1);
    assert.equal(originalsTodayCount(2, 1, 1), 2);
  });
});

describe("buildCoachingSnapshot", () => {
  let dir: string;
  let gamificationPath: string;
  let interactionStorePath: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-coaching-snapshot-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    getPlatformDb();
    gamificationPath = join(dir, "g.json");
    interactionStorePath = join(dir, "interactions.json");
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("counts a confirmed OG card today and completes original_1", async () => {
    const [card] = insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: NOW_MS,
      drafts: [{ kind: "post", why: "ship the recap", draft: "Shipped." }],
    });
    assert.ok(card);
    markSuggestion({
      id: card.id,
      userId: "u1",
      status: "done",
      postedTweetId: "1900000001",
      nowMs: NOW_MS,
    });

    const snapshot = await buildCoachingSnapshot({
      userId: "u1",
      tenantId: "local",
      nowMs: NOW_MS,
      gamificationPath,
      interactionStorePath,
    });
    assert.equal(snapshot.originalsToday, 1);
    const times = await loadInstrumentTimes({ userId: "u1", nowMs: NOW_MS });
    assert.deepEqual(times.originalAt, [new Date(NOW_MS).toISOString()]);

    const missions = await listMissionsWithProgress({
      userId: "u1",
      snapshot,
      nowMs: NOW_MS,
      gamificationPath,
    });
    const original = missions.find((m) => m.id === "original_1");
    assert.equal(original?.progress, 1);
    assert.equal(original?.completed, true);
  });

  it("does not double count an OG posted from desk compose and its confirmed card", async () => {
    const [card] = insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: NOW_MS,
      drafts: [{ kind: "post", why: "ship the recap", draft: "Shipped." }],
    });
    assert.ok(card);
    markSuggestion({
      id: card.id,
      userId: "u1",
      status: "done",
      postedTweetId: "1900000001",
      nowMs: NOW_MS,
    });
    recordDeskPost({
      userId: "u1",
      tweetId: "1900000001",
      inReplyToId: "",
      atIso: new Date(NOW_MS + 1_000).toISOString(),
    });

    const snapshot = await buildCoachingSnapshot({
      userId: "u1",
      tenantId: "local",
      nowMs: NOW_MS,
      gamificationPath,
      interactionStorePath,
    });
    assert.equal(snapshot.originalsToday, 1);
    const times = await loadInstrumentTimes({ userId: "u1", nowMs: NOW_MS });
    assert.deepEqual(times.originalAt, [new Date(NOW_MS + 1_000).toISOString()]);

    const missions = await listMissionsWithProgress({
      userId: "u1",
      snapshot,
      nowMs: NOW_MS,
      gamificationPath,
    });
    const original = missions.find((m) => m.id === "original_1");
    assert.equal(original?.progress, 1);
    assert.equal(original?.completed, true);
  });

  it("counts a webhook-ingested own_posts original and does not double count its confirmed card", async () => {
    const parsed: ParsedPostCreate = {
      eventUuid: "evt-w1",
      xUserId: "99",
      postId: "w1",
      kind: "original",
      text: "webhook original",
      postedAt: new Date(NOW_MS).toISOString(),
      inReplyToId: null,
      inReplyToUserId: null,
      conversationId: null,
      authorUsername: "desk",
      metrics: {},
    };
    upsertOwnPost({ parsed, userId: "u1", tenantId: "local" });

    const ownPostsOnly = await buildCoachingSnapshot({
      userId: "u1",
      tenantId: "local",
      nowMs: NOW_MS,
      gamificationPath,
      interactionStorePath,
    });
    assert.equal(ownPostsOnly.originalsToday, 1);
    assert.equal(ownPostsOnly.postsToday, 1);

    const [card] = insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: NOW_MS,
      drafts: [{ kind: "post", why: "ship the recap", draft: "Shipped." }],
    });
    assert.ok(card);
    markSuggestion({
      id: card.id,
      userId: "u1",
      status: "done",
      postedTweetId: "w1",
      nowMs: NOW_MS,
    });

    const withCard = await buildCoachingSnapshot({
      userId: "u1",
      tenantId: "local",
      nowMs: NOW_MS,
      gamificationPath,
      interactionStorePath,
    });
    assert.equal(withCard.originalsToday, 1);
    const times = await loadInstrumentTimes({ userId: "u1", nowMs: NOW_MS });
    assert.deepEqual(times.originalAt, [new Date(NOW_MS).toISOString()]);
  });

  it("counts a desk-composed original on its own", async () => {
    recordDeskPost({
      userId: "u1",
      tweetId: "1900000003",
      inReplyToId: "",
      atIso: new Date(NOW_MS).toISOString(),
    });

    const snapshot = await buildCoachingSnapshot({
      userId: "u1",
      tenantId: "local",
      nowMs: NOW_MS,
      gamificationPath,
      interactionStorePath,
    });
    assert.equal(snapshot.deskPostsToday, 1);
    assert.equal(snapshot.originalsToday, 1);
    const times = await loadInstrumentTimes({ userId: "u1", nowMs: NOW_MS });
    assert.deepEqual(times.originalAt, [new Date(NOW_MS).toISOString()]);
  });

  it("keeps distinct desk originals posted within five seconds", async () => {
    recordDeskPost({
      userId: "u1",
      tweetId: "1900000010",
      inReplyToId: "",
      atIso: new Date(NOW_MS).toISOString(),
    });
    recordDeskPost({
      userId: "u1",
      tweetId: "1900000011",
      inReplyToId: "",
      atIso: new Date(NOW_MS + 3_000).toISOString(),
    });

    const times = await loadInstrumentTimes({ userId: "u1", nowMs: NOW_MS });
    assert.deepEqual(times.originalAt, [
      new Date(NOW_MS + 3_000).toISOString(),
      new Date(NOW_MS).toISOString(),
    ]);
  });

  it("counts a discovered reply dated today toward marksToday", async () => {
    await markInteracted({
      threadId: "p-manual",
      author: "@a",
      source: "manual",
      userId: "u1",
      nowMs: NOW_MS,
      storePath: interactionStorePath,
    });
    await markInteracted({
      threadId: "p-phone",
      author: "@b",
      source: "discovered",
      userId: "u1",
      replyId: "r-phone",
      postedAt: new Date(NOW_MS - 24 * 60 * 60 * 1000).toISOString(),
      nowMs: NOW_MS - 60_000,
      storePath: interactionStorePath,
    });
    await markInteracted({
      threadId: "p-yesterday",
      author: "@c",
      source: "discovered",
      userId: "u1",
      replyId: "r-yesterday",
      nowMs: NOW_MS - 24 * 60 * 60 * 1000,
      storePath: interactionStorePath,
    });
    await markInteracted({
      threadId: "p-copy",
      author: "@d",
      source: "copy",
      userId: "u1",
      nowMs: NOW_MS,
      storePath: interactionStorePath,
    });

    const snapshot = await buildCoachingSnapshot({
      userId: "u1",
      tenantId: "local",
      nowMs: NOW_MS,
      gamificationPath,
      interactionStorePath,
    });
    assert.equal(snapshot.marksToday, 2);
    assert.equal(snapshot.manualMarksToday, 1);

    const missions = await listMissionsWithProgress({
      userId: "u1",
      snapshot,
      nowMs: NOW_MS,
      gamificationPath,
    });
    assert.equal(missions.find((m) => m.id === "mark_2")?.progress, 1);
  });

  it("counts own_posts originals and quotes on postsToday, not replies", async () => {
    upsertOwnPost({
      parsed: {
        eventUuid: "evt-og",
        xUserId: "99",
        postId: "og1",
        kind: "original",
        text: "og",
        postedAt: new Date(NOW_MS).toISOString(),
        inReplyToId: null,
        inReplyToUserId: null,
        conversationId: null,
        authorUsername: "desk",
        metrics: {},
      },
      userId: "u1",
      tenantId: "local",
    });
    upsertOwnPost({
      parsed: {
        eventUuid: "evt-qt",
        xUserId: "99",
        postId: "qt1",
        kind: "quote",
        text: "qt",
        postedAt: new Date(NOW_MS).toISOString(),
        inReplyToId: null,
        inReplyToUserId: null,
        conversationId: null,
        authorUsername: "desk",
        metrics: {},
      },
      userId: "u1",
      tenantId: "local",
    });
    upsertOwnPost({
      parsed: {
        eventUuid: "evt-re",
        xUserId: "99",
        postId: "re1",
        kind: "reply",
        text: "re",
        postedAt: new Date(NOW_MS).toISOString(),
        inReplyToId: "p1",
        inReplyToUserId: null,
        conversationId: null,
        authorUsername: "desk",
        metrics: {},
      },
      userId: "u1",
      tenantId: "local",
    });

    const snapshot = await buildCoachingSnapshot({
      userId: "u1",
      tenantId: "local",
      nowMs: NOW_MS,
      gamificationPath,
      interactionStorePath,
    });
    assert.equal(snapshot.quotesToday, 1);
    assert.equal(snapshot.repliesPostedToday, 1);
    assert.equal(snapshot.postsToday, 2);
    const times = await loadInstrumentTimes({
      userId: "u1",
      interactionStorePath,
      nowMs: NOW_MS,
    });
    assert.deepEqual(times.originalAt, [new Date(NOW_MS).toISOString()]);
    assert.equal(times.postAt.length, 2);
  });
});
