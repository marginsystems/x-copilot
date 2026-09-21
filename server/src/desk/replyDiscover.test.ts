import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, readFile, stat, writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listInteractionHistory,
  markInteracted,
} from "./interactionStore.ts";
import {
  buildOwnPostsQuery,
  buildOwnRepliesQuery,
  cardToOwnPostParsed,
  discoverOwnReplies,
  foldDiscoveredOwnPosts,
  ownPostKindFromCard,
  shouldImportDiscoveredReply,
} from "./replyDiscover.ts";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "../db.ts";
import { completeOnboarding } from "../auth/authStore.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { ensureUserTenant } from "../billing/billingStore.ts";
import {
  analyticsSummary,
  startOfUtcDayIso,
  upsertOwnPost,
  watchThread,
} from "./ownPostStore.ts";
import { getDeskBeats } from "./deskBeats.ts";
import { getGamification } from "./gamification.ts";
import {
  buildInteractionNotePath,
  updateInteractionMemoryOutcome,
  writeInteractionMemory,
} from "../memory/knowledgeMemory.ts";
import { resetInteractionMemoryProjectionForTests } from "../memory/interactionMemoryProjection.ts";
import type { Embedder } from "../memory/memoryIndex.ts";
import type { Interaction } from "./interactionStore.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import type { ThreadCard } from "../scout/threadCard.ts";
import { runStatsTick } from "../statsWorker.ts";

function ageUser(userId: string, days: number): void {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  getPlatformDb()
    .prepare(`UPDATE users SET created_at = ? WHERE id = ?`)
    .run(at, userId);
}

function card(
  partial: Partial<ThreadCard> & Pick<ThreadCard, "id">,
): ThreadCard {
  return {
    author: "@me",
    text: "hello from off-app",
    url: `https://x.com/me/status/${partial.id}`,
    ...partial,
  };
}

describe("buildOwnPostsQuery", () => {
  it("builds from: with within_time, excludes retweets, and no is:reply", () => {
    const q = buildOwnPostsQuery("@alice", "24h");
    assert.match(q, /^from:alice -is:retweet within_time:24h$/);
    assert.doesNotMatch(q, /is:reply/);
  });
});

describe("buildOwnRepliesQuery", () => {
  it("builds from: + is:reply with within_time", () => {
    const q = buildOwnRepliesQuery("@alice", "24h");
    assert.match(q, /^from:alice is:reply within_time:24h$/);
  });
});

describe("ownPostKindFromCard", () => {
  it("treats inReplyToId as a reply, quotes as quotes, and bare posts as originals", () => {
    assert.equal(
      ownPostKindFromCard(card({ id: "1", inReplyToId: "p" })),
      "reply",
    );
    assert.equal(ownPostKindFromCard(card({ id: "2" })), "original");
    assert.equal(ownPostKindFromCard(card({ id: "3", isQuote: true })), "quote");
  });
});

describe("cardToOwnPostParsed", () => {
  it("flags absent/garbage createdAt as a fallback with postedAt ≈ now", () => {
    const nowMs = Date.parse("2026-08-16T12:00:00.000Z");
    const absent = cardToOwnPostParsed(card({ id: "n1", text: "no date" }), {
      xUserId: "99",
      screenName: "me",
      nowMs,
    });
    assert.equal(absent.postedAtFallback, true);
    assert.equal(absent.postedAt, "2026-08-16T12:00:00.000Z");

    const garbage = cardToOwnPostParsed(
      card({ id: "n2", text: "garbage date", createdAt: "not-a-date" }),
      {
        xUserId: "99",
        screenName: "me",
        nowMs,
      },
    );
    assert.equal(garbage.postedAtFallback, true);
    assert.equal(garbage.postedAt, "2026-08-16T12:00:00.000Z");
  });

  it("parses a real createdAt into ISO postedAt without the fallback flag", () => {
    const parsed = cardToOwnPostParsed(
      card({ id: "n3", text: "dated", createdAt: "2026-08-16T11:00:00.000Z" }),
      {
        xUserId: "99",
        screenName: "me",
        nowMs: Date.parse("2026-08-16T12:00:00.000Z"),
      },
    );
    assert.equal(parsed.postedAtFallback, false);
    assert.equal(parsed.postedAt, "2026-08-16T11:00:00.000Z");
  });
});

describe("shouldImportDiscoveredReply", () => {
  const own = "me";
  const knownReplyIds = new Set<string>(["already"]);
  const knownThreadIds = new Set<string>(["parent-known"]);

  it("imports a fresh reply to someone else", () => {
    assert.equal(
      shouldImportDiscoveredReply({
        card: card({
          id: "r1",
          inReplyToId: "p1",
          inReplyToScreenName: "@other",
        }),
        ownScreenName: own,
        knownReplyIds,
        knownThreadIds,
      }),
      "import",
    );
  });

  it("skips missing parent fields", () => {
    assert.equal(
      shouldImportDiscoveredReply({
        card: card({ id: "r1" }),
        ownScreenName: own,
        knownReplyIds,
        knownThreadIds,
      }),
      "missing_parent",
    );
  });

  it("skips self-replies", () => {
    assert.equal(
      shouldImportDiscoveredReply({
        card: card({
          id: "r1",
          inReplyToId: "p1",
          inReplyToScreenName: "@Me",
        }),
        ownScreenName: own,
        knownReplyIds,
        knownThreadIds,
      }),
      "self_reply",
    );
  });

  it("skips known replyId / threadId", () => {
    assert.equal(
      shouldImportDiscoveredReply({
        card: card({
          id: "already",
          inReplyToId: "p2",
          inReplyToScreenName: "@other",
        }),
        ownScreenName: own,
        knownReplyIds,
        knownThreadIds,
      }),
      "known_reply",
    );
    assert.equal(
      shouldImportDiscoveredReply({
        card: card({
          id: "r2",
          inReplyToId: "parent-known",
          inReplyToScreenName: "@other",
        }),
        ownScreenName: own,
        knownReplyIds,
        knownThreadIds,
      }),
      "known_thread",
    );
  });
});

describe("discoverOwnReplies", () => {
  let dir: string;
  let temp: TempPlatformDb;
  let gamificationPath: string;
  let knowledgeRoot: string;
  const userId = "u1";
  const notePath = (threadId: string, interactedAt: string) =>
    buildInteractionNotePath({ userId, threadId, interactedAt, knowledgeRoot });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-copilot-discover-"));
    temp = openTempPlatformDb("x-copilot-discover-db-");
    seedUser(userId);
    gamificationPath = join(dir, "gamification.json");
    knowledgeRoot = join(dir, "knowledge");
  });

  afterEach(async () => {
    resetInteractionMemoryProjectionForTests();
    closeTempPlatformDb(temp);
    await rm(dir, { recursive: true, force: true });
  });

  it("upserts new replies and writes knowledge; skips dupes/self", async () => {
    await markInteracted({
      threadId: "already-parent",
      author: "@prior",
      replyId: "already-reply",
      replyUrl: "https://x.com/me/status/already-reply",
      source: "manual",
      nowMs: Date.parse("2026-08-02T10:00:00.000Z"),
      userId,
    });

    const now = Date.parse("2026-08-02T12:00:00.000Z");
    const result = await discoverOwnReplies({
      nowMs: now,
      userId,
      gamificationPath,
      knowledgeRoot,
      upsertMemory: false,
      session: {
        configured: true,
        bearerToken: "t",
      },
      resolveScreenName: async () => "me",
      searchTimelinePages: async (opts) => {
        assert.equal(opts.product, "Latest");
        assert.equal(opts.maxPages, 1);
        if (/is:reply/.test(opts.query)) {
          assert.match(opts.query, /^from:me is:reply within_time:24h$/);
          return {
            ok: true,
            threads: [
              card({
                id: "new-reply",
                text: "off-app take",
                inReplyToId: "new-parent",
                inReplyToScreenName: "@builder",
                conversationId: "conv-1",
                createdAt: "2026-08-02T11:30:00.000Z",
                opText: "parent lead",
              }),
              card({
                id: "already-reply",
                inReplyToId: "already-parent",
                inReplyToScreenName: "@prior",
              }),
              card({
                id: "self-reply",
                inReplyToId: "my-own",
                inReplyToScreenName: "@me",
              }),
              card({
                id: "no-parent",
                text: "not a reply card",
              }),
            ],
            queryId: "q",
            bottomCursor: null,
            pages: 1,
          };
        }
        assert.match(opts.query, /^from:me -is:retweet within_time:24h$/);
        assert.doesNotMatch(opts.query, /is:reply/);
        return {
          ok: true,
          threads: [],
          queryId: "q",
          bottomCursor: null,
          pages: 1,
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.discovered, 1);
    assert.equal(result.skipped, 3);
    assert.equal(result.searched, 4);

    const history = await listInteractionHistory({ userId });
    const row = history.find((h) => h.threadId === "new-parent");
    assert.ok(row);
    assert.equal(row.source, "discovered");
    assert.equal(row.author, "@builder");
    assert.equal(row.replyId, "new-reply");
    assert.equal(row.replyUrl, "https://x.com/me/status/new-reply");
    assert.equal(row.postedAt, "2026-08-02T11:30:00.000Z");
    assert.equal(row.conversationId, "conv-1");
    assert.equal(row.url, "https://x.com/builder/status/new-parent");

    const note = await readFile(
      notePath("new-parent", "2026-08-02T11:30:00.000Z"),
      "utf8",
    );
    assert.match(note, /source: discovered/);
    assert.match(note, /userId: "u1"/);
    assert.match(note, /off-app take/);
  });

  it("normalizes X's real created_at format to ISO postedAt", async () => {
    const result = await discoverOwnReplies({
      nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
      userId,
      gamificationPath,
      knowledgeRoot,
      upsertMemory: false,
      session: {
        configured: true,
        bearerToken: "t",
      },
      resolveScreenName: async () => "me",
      searchTimelinePages: async () => ({
        ok: true,
        threads: [
          card({
            id: "r-legacy",
            text: "off-app",
            inReplyToId: "p-legacy",
            inReplyToScreenName: "@other",
            createdAt: "Sat Jul 25 00:00:00 +0000 2026",
          }),
        ],
        queryId: "q",
        bottomCursor: null,
        pages: 1,
      }),
    });

    assert.equal(result.discovered, 1);
    const history = await listInteractionHistory({ userId });
    const row = history.find((h) => h.threadId === "p-legacy");
    assert.ok(row);
    assert.equal(row.postedAt, "2026-07-25T00:00:00.000Z");
  });

  it("is idempotent across ticks", async () => {
    const search = async () => ({
      ok: true as const,
      threads: [
        card({
          id: "r1",
          text: "once",
          inReplyToId: "p1",
          inReplyToScreenName: "@x",
        }),
      ],
      queryId: "q",
      bottomCursor: null,
      pages: 1,
    });
    const opts = {
      userId,
      gamificationPath,
      knowledgeRoot,
      upsertMemory: false as const,
      session: {
        configured: true,
        bearerToken: "t",
      },
      resolveScreenName: async () => "me",
      searchTimelinePages: search,
    };
    const first = await discoverOwnReplies(opts);
    const second = await discoverOwnReplies(opts);
    assert.equal(first.discovered, 1);
    assert.equal(second.discovered, 0);
    assert.equal(second.skipped, 1);
    const history = await listInteractionHistory({ userId });
    assert.equal(history.filter((h) => h.threadId === "p1").length, 1);
  });

  it("refreshes memory for a known webhook reply without re-marking it", async () => {
    const postedAt = "2026-08-02T11:30:00.000Z";
    const now = Date.parse("2026-08-02T12:00:00.000Z");
    await markInteracted({
      threadId: "webhook-parent",
      author: "@builder",
      replyId: "webhook-reply",
      replyUrl: "https://x.com/me/status/webhook-reply",
      source: "discovered",
      postedAt,
      userId,
    });

    const result = await discoverOwnReplies({
      nowMs: now,
      userId,
      gamificationPath,
      knowledgeRoot,
      upsertMemory: false,
      session: { configured: true, bearerToken: "t" },
      resolveScreenName: async () => "me",
      searchTimelinePages: async (opts) => ({
        ok: true as const,
        threads: /is:reply/.test(opts.query)
          ? [
              card({
                id: "webhook-reply",
                text: "updated reply",
                inReplyToId: "webhook-parent",
                inReplyToScreenName: "@builder",
                opText: "updated parent",
              }),
            ]
          : [],
        queryId: "q",
        bottomCursor: null,
        pages: 1,
      }),
    });

    assert.equal(result.discovered, 0);
    assert.equal(result.skipped, 1);
    const note = await readFile(notePath("webhook-parent", postedAt), "utf8");
    assert.match(note, /updated parent/);
    assert.match(note, /userId: "u1"/);
    assert.match(note, /interactedAt: "2026-08-02T11:30:00\.000Z"/);
    const history = await listInteractionHistory({ userId });
    assert.equal(history.length, 1);
    assert.equal(history[0]?.replyId, "webhook-reply");
  });

  it("continues when a known reply note belongs to another user", async () => {
    await markInteracted({
      threadId: "owned-parent",
      author: "@builder",
      replyId: "owned-reply",
      replyUrl: "https://x.com/me/status/owned-reply",
      source: "discovered",
      postedAt: "2026-08-02T11:30:00.000Z",
      userId,
    });
    resetInteractionMemoryProjectionForTests({
      writeNote: async () => {
        throw new Error("interaction note belongs to another user");
      },
    });

    const result = await discoverOwnReplies({
      nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
      userId,
      gamificationPath,
      knowledgeRoot,
      upsertMemory: false,
      session: { configured: true, bearerToken: "t" },
      resolveScreenName: async () => "me",
      searchTimelinePages: async (opts) => ({
        ok: true as const,
        threads: /is:reply/.test(opts.query)
          ? [
              card({
                id: "owned-reply",
                text: "known reply",
                inReplyToId: "owned-parent",
                inReplyToScreenName: "@builder",
              }),
            ]
          : [],
        queryId: "q",
        bottomCursor: null,
        pages: 1,
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, 1);
  });

  it("repairs a local confirmed own_posts reply without a new X read or XP", async () => {
    const postedAt = "2026-08-02T11:30:00.000Z";
    const markedAt = Date.parse("2026-08-02T18:00:00.000Z");
    let embedCalls = 0;
    const embedder: Embedder = {
      dimensions: 8,
      async embed() {
        embedCalls += 1;
        throw new Error("test embedder failure");
      },
    };
    await markInteracted({
      threadId: "local-parent",
      author: "@builder",
      replyId: "local-reply",
      replyUrl: "https://x.com/me/status/local-reply",
      source: "discovered",
      postedAt,
      text: "Saved parent text",
      nowMs: markedAt,
      userId,
    });
    upsertOwnPost({
      parsed: {
        eventUuid: "evt-local-reply",
        xUserId: "99",
        postId: "local-reply",
        kind: "reply",
        text: "confirmed webhook take",
        postedAt,
        inReplyToId: "local-parent",
        inReplyToUserId: null,
        conversationId: "conv-local",
        authorUsername: "me",
        metrics: {},
      },
      userId,
      tenantId: ensureUserTenant(userId),
    });
    const before = await getGamification({ userId, gamificationPath });

    const emptySearch = async () => ({
      ok: true as const,
      threads: [],
      queryId: "q",
      bottomCursor: null,
      pages: 1,
    });
    const first = await discoverOwnReplies({
      nowMs: Date.parse("2026-08-02T19:00:00.000Z"),
      userId,
      gamificationPath,
      knowledgeRoot,
      embedder,
      session: { configured: true, bearerToken: "t" },
      resolveScreenName: async () => "me",
      searchTimelinePages: emptySearch,
    });
    assert.equal(first.ok, true);
    assert.equal(first.discovered, 0);

    const localNotePath = notePath("local-parent", postedAt);
    const firstNote = await readFile(localNotePath, "utf8");
    assert.match(firstNote, /userId: "u1"/);
    assert.match(firstNote, /confirmed webhook take/);
    assert.match(firstNote, /Saved parent text/);
    assert.match(firstNote, /interactedAt: "2026-08-02T11:30:00\.000Z"/);
    assert.doesNotMatch(firstNote, /2026-08-02T18:00:00/);
    assert.doesNotMatch(firstNote, /## OP/);

    const second = await discoverOwnReplies({
      nowMs: Date.parse("2026-08-02T19:05:00.000Z"),
      userId,
      gamificationPath,
      knowledgeRoot,
      embedder,
      session: { configured: true, bearerToken: "t" },
      resolveScreenName: async () => "me",
      searchTimelinePages: emptySearch,
    });
    assert.equal(second.discovered, 0);
    const secondNote = await readFile(localNotePath, "utf8");
    assert.match(secondNote, /userId: "u1"/);
    assert.match(secondNote, /confirmed webhook take/);
    assert.match(secondNote, /interactedAt: "2026-08-02T11:30:00\.000Z"/);
    assert.equal((secondNote.match(/## Reply/g) ?? []).length, 1);
    assert.equal(embedCalls, 1);

    const history = await listInteractionHistory({ userId });
    assert.equal(history.length, 1);
    const after = await getGamification({ userId, gamificationPath });
    assert.equal(after.lifetimeXp, before.lifetimeXp);
    assert.equal(after.lifetimeMarks, before.lifetimeMarks);
  });

  it("does not overwrite a loop projection with differing own_posts text", async () => {
    const postedAt = "2026-08-02T11:30:00.000Z";
    await markInteracted({
      threadId: "projected-parent",
      author: "@builder",
      replyId: "projected-reply",
      replyUrl: "https://x.com/me/status/projected-reply",
      source: "discovered",
      postedAt,
      userId,
    });
    upsertOwnPost({
      parsed: {
        eventUuid: "evt-projected-reply",
        xUserId: "99",
        postId: "projected-reply",
        kind: "reply",
        text: "stale own_posts text",
        postedAt,
        inReplyToId: "projected-parent",
        inReplyToUserId: null,
        conversationId: "conv-projected",
        authorUsername: "me",
        metrics: {},
      },
      userId,
      tenantId: ensureUserTenant(userId),
    });

    await discoverOwnReplies({
      nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
      userId,
      gamificationPath,
      knowledgeRoot,
      upsertMemory: false,
      session: { configured: true, bearerToken: "t" },
      resolveScreenName: async () => "me",
      searchTimelinePages: async (opts) => ({
        ok: true as const,
        threads: /is:reply/.test(opts.query)
          ? [
              card({
                id: "projected-reply",
                text: "fresh loop projection",
                inReplyToId: "projected-parent",
                inReplyToScreenName: "@builder",
              }),
            ]
          : [],
        queryId: "q",
        bottomCursor: null,
        pages: 1,
      }),
    });

    const note = await readFile(notePath("projected-parent", postedAt), "utf8");
    assert.match(note, /fresh loop projection/);
    assert.doesNotMatch(note, /stale own_posts text/);
  });

  it("repairs a known reply when the loop projection has no text", async () => {
    const postedAt = "2026-08-02T11:30:00.000Z";
    await markInteracted({
      threadId: "empty-projection-parent",
      author: "@builder",
      replyId: "empty-projection-reply",
      replyUrl: "https://x.com/me/status/empty-projection-reply",
      source: "discovered",
      postedAt,
      userId,
    });
    upsertOwnPost({
      parsed: {
        eventUuid: "evt-empty-projection-reply",
        xUserId: "99",
        postId: "empty-projection-reply",
        kind: "reply",
        text: "confirmed text",
        postedAt,
        inReplyToId: "empty-projection-parent",
        inReplyToUserId: null,
        conversationId: "conv-empty-projection",
        authorUsername: "me",
        metrics: {},
      },
      userId,
      tenantId: ensureUserTenant(userId),
    });

    await discoverOwnReplies({
      nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
      userId,
      gamificationPath,
      knowledgeRoot,
      upsertMemory: false,
      session: { configured: true, bearerToken: "t" },
      resolveScreenName: async () => "me",
      searchTimelinePages: async (opts) => ({
        ok: true as const,
        threads: /is:reply/.test(opts.query)
          ? [
              card({
                id: "empty-projection-reply",
                text: "",
                inReplyToId: "empty-projection-parent",
                inReplyToScreenName: "@builder",
              }),
            ]
          : [],
        queryId: "q",
        bottomCursor: null,
        pages: 1,
      }),
    });

    const note = await readFile(
      notePath("empty-projection-parent", postedAt),
      "utf8",
    );
    assert.match(note, /confirmed text/);
  });

  it("reconciles a known reply when the loop projection is unavailable", async () => {
    const postedAt = "2026-08-02T11:30:00.000Z";
    await markInteracted({
      threadId: "unavailable-projection-parent",
      author: "@builder",
      replyId: "unavailable-projection-reply",
      replyUrl: "https://x.com/me/status/unavailable-projection-reply",
      source: "discovered",
      postedAt,
      userId,
    });
    upsertOwnPost({
      parsed: {
        eventUuid: "evt-unavailable-projection-reply",
        xUserId: "99",
        postId: "unavailable-projection-reply",
        kind: "reply",
        text: "confirmed after write failure",
        postedAt,
        inReplyToId: "unavailable-projection-parent",
        inReplyToUserId: null,
        conversationId: null,
        authorUsername: "me",
        metrics: {},
      },
      userId,
      tenantId: ensureUserTenant(userId),
    });

    let writes = 0;
    resetInteractionMemoryProjectionForTests({
      writeNote: async (input) => {
        writes += 1;
        if (writes === 1) throw new Error("knowledge write unavailable");
        return writeInteractionMemory(input);
      },
    });

    await discoverOwnReplies({
      nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
      userId,
      gamificationPath,
      knowledgeRoot,
      upsertMemory: false,
      session: { configured: true, bearerToken: "t" },
      resolveScreenName: async () => "me",
      searchTimelinePages: async (opts) => ({
        ok: true as const,
        threads: /is:reply/.test(opts.query)
          ? [
              card({
                id: "unavailable-projection-reply",
                text: "loop reply text",
                inReplyToId: "unavailable-projection-parent",
                inReplyToScreenName: "@builder",
              }),
            ]
          : [],
        queryId: "q",
        bottomCursor: null,
        pages: 1,
      }),
    });

    const note = await readFile(
      notePath("unavailable-projection-parent", postedAt),
      "utf8",
    );
    assert.match(note, /confirmed after write failure/);
    assert.equal(writes, 2);
  });

  it("uses watched-thread context when the interaction has no context", async () => {
    const postedAt = "2026-08-02T11:30:00.000Z";
    await markInteracted({
      threadId: "watched-parent",
      author: "@builder",
      replyId: "watched-reply",
      source: "discovered",
      postedAt,
      userId,
    });
    watchThread({
      userId,
      threadId: "watched-parent",
      url: "https://x.com/builder/status/watched-url",
      text: "watched parent text",
    });
    upsertOwnPost({
      parsed: {
        eventUuid: "evt-watched-reply",
        xUserId: "99",
        postId: "watched-reply",
        kind: "reply",
        text: "watched reply text",
        postedAt,
        inReplyToId: "watched-parent",
        inReplyToUserId: null,
        conversationId: null,
        authorUsername: "me",
        metrics: {},
      },
      userId,
      tenantId: ensureUserTenant(userId),
    });

    await discoverOwnReplies({
      nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
      userId,
      gamificationPath,
      knowledgeRoot,
      upsertMemory: false,
      session: { configured: true, bearerToken: "t" },
      resolveScreenName: async () => "me",
      searchTimelinePages: async () => ({
        ok: true as const,
        threads: [],
        queryId: "q",
        bottomCursor: null,
        pages: 1,
      }),
    });

    const note = await readFile(notePath("watched-parent", postedAt), "utf8");
    assert.match(note, /https:\/\/x\.com\/builder\/status\/watched-url/);
    assert.match(note, /watched parent text/);
    assert.doesNotMatch(note, /\(no thread text\)/);
  });

  it("repairs a missing own note even when a foreign or unowned file shares the thread and date", async () => {
    const postedAt = "2026-08-02T11:30:00.000Z";
    await markInteracted({
      threadId: "shared-parent",
      author: "@builder",
      replyId: "shared-reply",
      source: "discovered",
      postedAt,
      userId,
    });
    upsertOwnPost({
      parsed: {
        eventUuid: "evt-shared-reply",
        xUserId: "99",
        postId: "shared-reply",
        kind: "reply",
        text: "my confirmed take",
        postedAt,
        inReplyToId: "shared-parent",
        inReplyToUserId: null,
        conversationId: null,
        authorUsername: "me",
        metrics: {},
      },
      userId,
      tenantId: ensureUserTenant(userId),
    });
    const foreign = await writeInteractionMemory({
      threadId: "shared-parent",
      author: "@builder",
      reply: "someone else's take",
      userId: "u2",
      interactedAt: postedAt,
      knowledgeRoot,
    });
    const legacyPath = join(knowledgeRoot, "interactions", "2026-08-02-shared-parent.md");
    const unowned = `---\ntype: interaction\nthreadId: "shared-parent"\ninteractedAt: "${postedAt}"\n---\n\n## Reply\n\nunowned legacy\n`;
    await writeFile(legacyPath, unowned, "utf8");

    const run = () =>
      discoverOwnReplies({
        nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
        userId,
        gamificationPath,
        knowledgeRoot,
        upsertMemory: false,
        session: { configured: true, bearerToken: "t" },
        resolveScreenName: async () => "me",
        searchTimelinePages: async () => ({
          ok: true as const,
          threads: [],
          queryId: "q",
          bottomCursor: null,
          pages: 1,
        }),
      });
    await run();
    const own = await readFile(notePath("shared-parent", postedAt), "utf8");
    assert.match(own, /userId: "u1"/);
    assert.match(own, /my confirmed take/);
    assert.match(await readFile(foreign.path, "utf8"), /someone else's take/);
    assert.equal(await readFile(legacyPath, "utf8"), unowned);

    // Once our own verified note exists, reconciliation leaves it alone.
    const beforeReconciliation = await stat(own.path);
    const beforeContent = await readFile(own.path, "utf8");
    await run();
    const afterReconciliation = await stat(own.path);
    assert.equal(afterReconciliation.mtimeNs, beforeReconciliation.mtimeNs);
    assert.equal(await readFile(own.path, "utf8"), beforeContent);
  });

  it("indexes a note repaired from own_posts", async () => {
    const interactedAt = "2026-08-02T11:30:00.000Z";
    await markInteracted({
      threadId: "reconcile-parent",
      author: "@builder",
      replyId: "reconcile-reply",
      source: "manual",
      postedAt: interactedAt,
      text: "Saved parent text",
      userId,
    });
    upsertOwnPost({
      parsed: {
        eventUuid: "evt-reconcile-reply",
        xUserId: "99",
        postId: "reconcile-reply",
        kind: "reply",
        text: "Repaired own reply",
        postedAt: interactedAt,
        inReplyToId: "reconcile-parent",
        inReplyToUserId: null,
        conversationId: null,
        authorUsername: "me",
        metrics: {},
      },
      userId,
      tenantId: ensureUserTenant(userId),
    });

    let embedded = 0;
    const embedder: Embedder = {
      dimensions: 8,
      async embed(texts) {
        embedded += texts.length;
        return texts.map(() => new Float32Array(8));
      },
    };
    await discoverOwnReplies({
      nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
      userId,
      gamificationPath,
      knowledgeRoot,
      indexDir: join(dir, "index"),
      embedder,
      session: { configured: true, bearerToken: "t" },
      resolveScreenName: async () => "me",
      searchTimelinePages: async () => ({
        ok: true as const,
        threads: [],
        queryId: "q",
        bottomCursor: null,
        pages: 1,
      }),
    });

    assert.ok(embedded > 0);
  });

  it("leaves unknown parent context absent when no matching interaction exists", async () => {
    upsertOwnPost({
      parsed: {
        eventUuid: "evt-orphan-reply",
        xUserId: "99",
        postId: "orphan-reply",
        kind: "reply",
        text: "ingest-only take",
        postedAt: "2026-08-02T11:30:00.000Z",
        inReplyToId: "orphan-parent",
        inReplyToUserId: null,
        conversationId: null,
        authorUsername: "me",
        metrics: {},
      },
      userId,
      tenantId: ensureUserTenant(userId),
    });
    await discoverOwnReplies({
      nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
      userId,
      gamificationPath,
      knowledgeRoot,
      upsertMemory: false,
      session: { configured: true, bearerToken: "t" },
      resolveScreenName: async () => "me",
      searchTimelinePages: async () => ({
        ok: true as const,
        threads: [],
        queryId: "q",
        bottomCursor: null,
        pages: 1,
      }),
    });
    const interactionDir = join(knowledgeRoot, "interactions");
    let interactionNames: string[] = [];
    try {
      interactionNames = await readdir(interactionDir);
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
    }
    assert.deepEqual(
      interactionNames.filter((name) => name.endsWith(".md")),
      [],
    );
    assert.equal((await listInteractionHistory({ userId })).length, 0);
  });

  it("keeps curated context and outcome when a known reply is rediscovered", async () => {
    const interactedAt = "2026-08-02T11:30:00.000Z";
    await markInteracted({
      threadId: "curated-parent",
      author: "@builder",
      replyId: "curated-reply",
      source: "manual",
      postedAt: interactedAt,
      text: "Curated post",
      userId,
    });
    await writeInteractionMemory({
      threadId: "curated-parent",
      author: "@builder",
      reply: "kept reply",
      userId,
      source: "manual",
      text: "Curated post",
      summary: "Keep this summary",
      agenda: "Keep this agenda",
      knowledgeRoot,
      interactedAt,
    });
    const outcome = await updateInteractionMemoryOutcome({
      interaction: {
        threadId: "curated-parent",
        author: "@builder",
        authorKey: "builder",
        at: interactedAt,
        source: "manual",
        userId,
        stats: {
          t1h: {
            views: 100,
            likes: 4,
            replies: 1,
            retweets: 0,
            sampledAt: "2026-08-02T12:30:00.000Z",
          },
        },
      } as Interaction,
      knowledgeRoot,
      nowIso: "2026-08-02T12:30:00.000Z",
    });
    assert.equal(outcome.ok, true);

    await discoverOwnReplies({
      nowMs: Date.parse("2026-08-02T13:00:00.000Z"),
      userId,
      gamificationPath,
      knowledgeRoot,
      upsertMemory: false,
      session: { configured: true, bearerToken: "t" },
      resolveScreenName: async () => "me",
      searchTimelinePages: async (opts) => ({
        ok: true as const,
        threads: /is:reply/.test(opts.query)
          ? [
              card({
                id: "curated-reply",
                text: "kept reply",
                inReplyToId: "curated-parent",
                inReplyToScreenName: "@builder",
                opText: "Fresh search result",
              }),
            ]
          : [],
        queryId: "q",
        bottomCursor: null,
        pages: 1,
      }),
    });

    const body = await readFile(notePath("curated-parent", interactedAt), "utf8");
    assert.match(body, /userId: "u1"/);
    assert.match(body, /## Outcome/);
    assert.match(body, /views1h: 100/);
    assert.match(body, /Keep this summary/);
    assert.match(body, /Keep this agenda/);
    assert.match(body, /Curated post/);
    assert.match(body, /x\.com\/builder\/status\/curated-parent/);
    assert.doesNotMatch(body, /Fresh search result/);
  });

  it("keeps the saved note when MiniLM upsert is unavailable", async () => {
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    };
    const bad: Embedder = {
      dimensions: 8,
      async embed() {
        throw new Error("MiniLM unavailable");
      },
    };
    try {
      const result = await discoverOwnReplies({
        nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
        userId,
        gamificationPath,
        knowledgeRoot,
        indexDir: join(dir, "index"),
        embedder: bad,
        session: { configured: true, bearerToken: "t" },
        resolveScreenName: async () => "me",
        searchTimelinePages: async (opts) => ({
          ok: true as const,
          threads: /is:reply/.test(opts.query)
            ? [
                card({
                  id: "idx-reply",
                  text: "indexed later",
                  inReplyToId: "idx-parent",
                  inReplyToScreenName: "@other",
                  createdAt: "2026-08-02T11:30:00.000Z",
                }),
              ]
            : [],
          queryId: "q",
          bottomCursor: null,
          pages: 1,
        }),
      });
      assert.equal(result.discovered, 1);
    } finally {
      console.warn = origWarn;
    }
    const note = await readFile(
      notePath("idx-parent", "2026-08-02T11:30:00.000Z"),
      "utf8",
    );
    assert.match(note, /userId: "u1"/);
    assert.match(note, /indexed later/);
    assert.ok(
      warns.some((line) => /upsert soft-fail|MiniLM unavailable/.test(line)),
      `expected upsert failure to be observed, got: ${warns.join(" | ")}`,
    );
  });

  it("soft-fails when no desk handle is provided", async () => {
    const result = await discoverOwnReplies({
      session: {
        configured: true,
        bearerToken: "t",
      },
      userId,
      gamificationPath,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "screen_name_unresolved");
    assert.equal(result.discovered, 0);
  });

  it("soft-fails when credentials missing", async () => {
    const result = await discoverOwnReplies({
      session: {
        configured: false,
        bearerToken: "",
      },
      userId,
      gamificationPath,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_credentials");
    assert.equal(result.discovered, 0);
  });

  it("folds the own-posts page and the is:reply page into own_posts", async () => {
    const folded: string[] = [];
    const result = await discoverOwnReplies({
      userId,
      gamificationPath,
      knowledgeRoot,
      upsertMemory: false,
      session: {
        configured: true,
        bearerToken: "t",
      },
      resolveScreenName: async () => "me",
      foldOwnPosts: async ({ threads, screenName }) => {
        assert.equal(screenName, "me");
        for (const row of threads) folded.push(row.id);
        return threads.length;
      },
      searchTimelinePages: async (opts) => {
        if (/is:reply/.test(opts.query)) {
          return {
            ok: true,
            threads: [
              card({
                id: "r-fold",
                text: "reply take",
                inReplyToId: "p-fold",
                inReplyToScreenName: "@other",
              }),
            ],
            queryId: "q",
            bottomCursor: null,
            pages: 1,
          };
        }
        return {
          ok: true,
          threads: [card({ id: "orig-1", text: "shipping note" })],
          queryId: "q",
          bottomCursor: null,
          pages: 1,
        };
      },
    });
    assert.deepEqual(folded, ["orig-1", "r-fold"]);
    assert.equal(result.ownPostsIngested, 2);
    assert.equal(result.discovered, 1);
  });
});

describe("discoverOwnReplies desk beats", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-discover-beats-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    getPlatformDb();
    seedUser("u1");
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("stamps userId and records scout for a watched parent, organic otherwise", async () => {
    const now = Date.parse("2026-08-02T12:00:00.000Z");
    const gamificationPath = join(dir, "gamification.json");
    watchThread({ userId: "u1", threadId: "scouted-parent", author: "@lead" });

    const search = async (opts: { query: string }) => ({
      ok: true as const,
      threads: /is:reply/.test(opts.query)
        ? [
            card({
              id: "r-scout",
              inReplyToId: "scouted-parent",
              inReplyToScreenName: "@lead",
              createdAt: "2026-08-02T11:30:00.000Z",
            }),
            card({
              id: "r-organic",
              inReplyToId: "organic-parent",
              inReplyToScreenName: "@stranger",
              createdAt: "2026-08-02T11:40:00.000Z",
            }),
          ]
        : [],
      queryId: "q",
      bottomCursor: null,
      pages: 1,
    });

    const result = await discoverOwnReplies({
      nowMs: now,
      knowledgeRoot: join(dir, "knowledge"),
      upsertMemory: false,
      session: { configured: true, bearerToken: "t" },
      screenName: "me",
      userId: "u1",
      gamificationPath,
      searchTimelinePages: search,
    });
    assert.equal(result.discovered, 2);

    const history = await listInteractionHistory({ userId: "u1" });
    assert.equal(history.length, 2);
    assert.ok(history.every((row) => row.source === "discovered"));

    const beats = getDeskBeats({ userId: "u1", nowMs: now });
    assert.equal(beats.scoutReplyDone, true);
    assert.equal(beats.organicReplyDone, true);
  });

  it("dates an organic beat by discovery time, not the reply timestamp", async () => {
    const postedAt = Date.parse("2026-08-02T23:50:00.000Z");
    const discoveredAt = Date.parse("2026-08-03T00:10:00.000Z");
    const gamificationPath = join(dir, "gamification.json");
    const result = await discoverOwnReplies({
      nowMs: discoveredAt,
      knowledgeRoot: join(dir, "knowledge"),
      upsertMemory: false,
      session: { configured: true, bearerToken: "t" },
      screenName: "me",
      userId: "u1",
      gamificationPath,
      searchTimelinePages: async () => ({
        ok: true as const,
        threads: [
          card({
            id: "r-midnight",
            inReplyToId: "organic-parent",
            inReplyToScreenName: "@stranger",
            createdAt: new Date(postedAt).toISOString(),
          }),
        ],
        queryId: "q",
        bottomCursor: null,
        pages: 1,
      }),
    });
    assert.equal(result.discovered, 1);
    assert.equal(
      getDeskBeats({ userId: "u1", nowMs: discoveredAt }).organicReplyDone,
      true,
    );
  });
});

describe("foldDiscoveredOwnPosts", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-fold-own-"));
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

  it("writes originals and replies for the matching handle", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    const n = await foldDiscoveredOwnPosts({
      screenName: "me",
      nowMs: Date.parse("2026-08-16T12:00:00.000Z"),
      resolveXUserId: async () => "99",
      threads: [
        card({
          id: "orig-1",
          text: "original take",
          createdAt: "2026-08-16T11:00:00.000Z",
        }),
        card({
          id: "r-1",
          text: "reply take",
          inReplyToId: "p-1",
          createdAt: "2026-08-16T11:30:00.000Z",
        }),
      ],
    });
    assert.equal(n, 2);
    const summary = analyticsSummary(user.id);
    assert.equal(summary.totals.posts, 2);
    assert.equal(summary.totals.originals, 1);
    assert.equal(summary.totals.replies, 1);
  });

  it("writes nothing when no desk user owns the handle", async () => {
    const n = await foldDiscoveredOwnPosts({
      screenName: "nobody",
      nowMs: Date.now(),
      resolveXUserId: async () => "1",
      threads: [card({ id: "x", text: "nope" })],
    });
    assert.equal(n, 0);
  });

  it("dedups a re-fold of the same threads by post id", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    const opts = {
      screenName: "me",
      nowMs: Date.parse("2026-08-16T12:00:00.000Z"),
      resolveXUserId: async () => "99",
      threads: [
        card({
          id: "orig-1",
          text: "original take",
          createdAt: "2026-08-16T11:00:00.000Z",
        }),
        card({
          id: "r-1",
          text: "reply take",
          inReplyToId: "p-1",
          createdAt: "2026-08-16T11:30:00.000Z",
        }),
      ],
    };
    const first = await foldDiscoveredOwnPosts(opts);
    const second = await foldDiscoveredOwnPosts(opts);
    assert.equal(first, 2);
    assert.equal(second, 0);
    const summary = analyticsSummary(user.id);
    assert.equal(summary.totals.posts, 2);
    assert.equal(summary.totals.originals, 1);
    assert.equal(summary.totals.replies, 1);
  });

  it("folds cards without a parseable createdAt via a repairable fallback timestamp", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    const nowMs = Date.parse("2026-08-16T12:00:00.000Z");
    const n = await foldDiscoveredOwnPosts({
      screenName: "me",
      nowMs,
      resolveXUserId: async () => "99",
      threads: [
        card({ id: "no-created", text: "timestampless take" }),
        card({ id: "garbage-created", text: "garbage date", createdAt: "nope" }),
      ],
    });
    assert.equal(n, 2);
    const fallbackRow = getPlatformDb()
      .prepare(`SELECT posted_at FROM own_posts WHERE id = ?`)
      .get("no-created") as { posted_at: string };
    assert.equal(fallbackRow.posted_at, "2026-08-16T12:00:00.000Z");

    // A re-fold that finally carries the real created_at repairs the stored
    // posted_at instead of freezing the discovery-time fallback forever.
    const reFold = await foldDiscoveredOwnPosts({
      screenName: "me",
      nowMs,
      resolveXUserId: async () => "99",
      threads: [
        card({
          id: "no-created",
          text: "timestampless take",
          createdAt: "2026-08-16T10:00:00.000Z",
        }),
      ],
    });
    assert.equal(reFold, 0);
    const repaired = getPlatformDb()
      .prepare(`SELECT posted_at FROM own_posts WHERE id = ?`)
      .get("no-created") as { posted_at: string };
    assert.equal(repaired.posted_at, "2026-08-16T10:00:00.000Z");

    // A later fold that again lacks the timestamp must not clobber the real
    // posted_at back to discovery time — the fallback flag keeps it.
    const fallbackReFold = await foldDiscoveredOwnPosts({
      screenName: "me",
      nowMs,
      resolveXUserId: async () => "99",
      threads: [card({ id: "no-created", text: "timestampless take" })],
    });
    assert.equal(fallbackReFold, 0);
    const stillReal = getPlatformDb()
      .prepare(`SELECT posted_at FROM own_posts WHERE id = ?`)
      .get("no-created") as { posted_at: string };
    assert.equal(stillReal.posted_at, "2026-08-16T10:00:00.000Z");
  });

  it("stops the fold once the daily watch cap is reached", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    const tenantId = ensureUserTenant(user.id);
    ageUser(user.id, 8);
    const today = startOfUtcDayIso();
    for (let i = 0; i < 15; i++) {
      upsertOwnPost({
        parsed: {
          eventUuid: `evt-seed-${i}`,
          xUserId: "99",
          postId: `seed-${i}`,
          kind: "original",
          text: "seed",
          postedAt: today,
          inReplyToId: null,
          inReplyToUserId: null,
          conversationId: null,
          authorUsername: "me",
          metrics: {},
        },
        userId: user.id,
        tenantId,
      });
    }
    const n = await foldDiscoveredOwnPosts({
      screenName: "me",
      nowMs: Date.parse("2026-08-16T12:00:00.000Z"),
      resolveXUserId: async () => "99",
      threads: [
        card({
          id: "cap-1",
          text: "too many",
          createdAt: "2026-08-16T11:00:00.000Z",
        }),
      ],
    });
    assert.equal(n, 0);
    assert.equal(analyticsSummary(user.id).totals.posts, 15);
  });

  it("truncates a page mid-way at the daily cap", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    const tenantId = ensureUserTenant(user.id);
    ageUser(user.id, 8);
    const today = startOfUtcDayIso();
    for (let i = 0; i < 14; i++) {
      upsertOwnPost({
        parsed: {
          eventUuid: `evt-seed-${i}`,
          xUserId: "99",
          postId: `seed-${i}`,
          kind: "original",
          text: "seed",
          postedAt: today,
          inReplyToId: null,
          inReplyToUserId: null,
          conversationId: null,
          authorUsername: "me",
          metrics: {},
        },
        userId: user.id,
        tenantId,
      });
    }
    const n = await foldDiscoveredOwnPosts({
      screenName: "me",
      nowMs: Date.parse("2026-08-16T12:00:00.000Z"),
      resolveXUserId: async () => "99",
      threads: [
        card({
          id: "cap-1",
          text: "fits",
          createdAt: "2026-08-16T11:00:00.000Z",
        }),
        card({
          id: "cap-2",
          text: "truncated",
          createdAt: "2026-08-16T11:05:00.000Z",
        }),
      ],
    });
    assert.equal(n, 1);
    const summary = analyticsSummary(user.id);
    assert.equal(summary.totals.posts, 15);
  });

  it("does not match a Google user who never linked X", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-1",
      email: "me@example.com",
      emailVerified: true,
    });
    completeOnboarding(user.id, "Find builders shipping AI tools in public.");
    const n = await foldDiscoveredOwnPosts({
      screenName: "me",
      nowMs: Date.parse("2026-08-16T12:00:00.000Z"),
      resolveXUserId: async () => "99",
      threads: [
        card({
          id: "orig-onboard",
          text: "onboarding-only take",
          createdAt: "2026-08-16T11:00:00.000Z",
        }),
      ],
    });
    assert.equal(n, 0);
    assert.equal(analyticsSummary(user.id).totals.posts, 0);
  });

  it("resolves xUserId from the stored X oauth via the default chain", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    const n = await foldDiscoveredOwnPosts({
      screenName: "me",
      nowMs: Date.parse("2026-08-16T12:00:00.000Z"),
      threads: [
        card({
          id: "orig-stored",
          text: "stored identity take",
          createdAt: "2026-08-16T11:00:00.000Z",
        }),
      ],
    });
    assert.equal(n, 1);
    assert.equal(analyticsSummary(user.id).totals.posts, 1);
  });

  it("attributes the fold to the X oauth owner, not a handle claimed in onboarding", async () => {
    const claimant = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-claim",
      email: "claim@example.com",
      emailVerified: true,
    });
    completeOnboarding(claimant.id, "Find builders shipping AI tools in public.");
    const operator = upsertOauthUser({
      provider: "x",
      providerUserId: "op-xid",
      emailVerified: false,
      username: "me",
    });
    const n = await foldDiscoveredOwnPosts({
      screenName: "me",
      nowMs: Date.parse("2026-08-16T12:00:00.000Z"),
      resolveXUserId: async () => "op-xid",
      threads: [
        card({
          id: "orig-pinned",
          text: "operator post",
          createdAt: "2026-08-16T11:00:00.000Z",
        }),
      ],
    });
    assert.equal(n, 1);
    assert.equal(analyticsSummary(operator.id).totals.posts, 1);
    assert.equal(analyticsSummary(claimant.id).totals.posts, 0);
  });
});

describe("runStatsTick discovery wiring", () => {
  let temp: TempPlatformDb;

  beforeEach(() => {
    temp = openTempPlatformDb("x-copilot-discover-tick-");
    seedUser("u1");
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  it("runs discovery before metrics and reports counts", async () => {
    let discoverCalls = 0;
    const result = await runStatsTick({
      delayMs: 0,
      syncOutcome: null,
      fetchMetrics: async () => null,
      discoverReplies: async () => {
        discoverCalls += 1;
        await markInteracted({
          threadId: "p-discovered",
          author: "@target",
          source: "discovered",
          userId: "u1",
          replyId: "r-discovered",
          replyUrl: "https://x.com/me/status/r-discovered",
          nowMs: Date.parse("2026-08-02T10:00:00.000Z"),
        });
        return {
          ok: true,
          searched: 1,
          discovered: 1,
          skipped: 0,
        };
      },
    });
    assert.equal(discoverCalls, 1);
    assert.equal(result.discovered, 1);
    const history = await listInteractionHistory({ userId: "u1" });
    assert.equal(history[0]?.source, "discovered");
  });
});
