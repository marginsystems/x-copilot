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
  originalsTodayCount,
} from "./coachingSnapshot.ts";
import { listMissionsWithProgress } from "./dailyMissions.ts";
import { insertSuggestions, markSuggestion } from "./forYouStore.ts";
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
    markSuggestion({ id: card.id, userId: "u1", status: "done", nowMs: NOW_MS });

    const snapshot = await buildCoachingSnapshot({
      userId: "u1",
      tenantId: "local",
      nowMs: NOW_MS,
      gamificationPath,
      interactionStorePath,
    });
    assert.equal(snapshot.originalsToday, 1);

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
    markSuggestion({ id: card.id, userId: "u1", status: "done", nowMs: NOW_MS });
    recordDeskPost({
      userId: "u1",
      tweetId: "1900000001",
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
    assert.equal(snapshot.originalsToday, 1);

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

    const [card] = insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: NOW_MS,
      drafts: [{ kind: "post", why: "ship the recap", draft: "Shipped." }],
    });
    assert.ok(card);
    markSuggestion({ id: card.id, userId: "u1", status: "done", nowMs: NOW_MS });

    const withCard = await buildCoachingSnapshot({
      userId: "u1",
      tenantId: "local",
      nowMs: NOW_MS,
      gamificationPath,
      interactionStorePath,
    });
    assert.equal(withCard.originalsToday, 1);
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
  });
});
