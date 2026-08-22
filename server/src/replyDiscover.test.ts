import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
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
  discoverOwnReplies,
  foldDiscoveredOwnPosts,
  ownPostKindFromCard,
  shouldImportDiscoveredReply,
} from "./replyDiscover.ts";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { completeOnboarding, upsertOauthUser } from "./authStore.ts";
import { ensureUserTenant } from "./billingStore.ts";
import {
  analyticsSummary,
  startOfUtcDayIso,
  upsertOwnPost,
} from "./ownPostStore.ts";
import type { ThreadCard } from "./threadCard.ts";
import { runStatsTick } from "./statsWorker.ts";

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
  let storePath: string;
  let knowledgeRoot: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-copilot-discover-"));
    storePath = join(dir, "interactions.json");
    knowledgeRoot = join(dir, "knowledge");
  });

  afterEach(async () => {
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
      storePath,
    });

    const now = Date.parse("2026-08-02T12:00:00.000Z");
    const result = await discoverOwnReplies({
      nowMs: now,
      storePath,
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

    const history = await listInteractionHistory({ storePath });
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
      join(knowledgeRoot, "interactions", "2026-08-02-new-parent.md"),
      "utf8",
    );
    assert.match(note, /source: discovered/);
    assert.match(note, /off-app take/);
  });

  it("normalizes X's real created_at format to ISO postedAt", async () => {
    const result = await discoverOwnReplies({
      nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
      storePath,
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
    const history = await listInteractionHistory({ storePath });
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
      storePath,
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
    const history = await listInteractionHistory({ storePath });
    assert.equal(history.filter((h) => h.threadId === "p1").length, 1);
  });

  it("soft-fails when no desk handle is provided", async () => {
    const result = await discoverOwnReplies({
      session: {
        configured: true,
        bearerToken: "t",
      },
      storePath,
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
      storePath,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_credentials");
    assert.equal(result.discovered, 0);
  });

  it("folds the own-posts page and the is:reply page into own_posts", async () => {
    const folded: string[] = [];
    const result = await discoverOwnReplies({
      storePath,
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

  it("stops the fold once the daily watch cap is reached", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    const tenantId = ensureUserTenant(user.id);
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
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-copilot-discover-tick-"));
    storePath = join(dir, "interactions.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runs discovery before metrics and reports counts", async () => {
    let discoverCalls = 0;
    const result = await runStatsTick({
      storePath,
      delayMs: 0,
      syncOutcome: null,
      fetchMetrics: async () => null,
      discoverReplies: async () => {
        discoverCalls += 1;
        await markInteracted({
          threadId: "p-discovered",
          author: "@target",
          source: "discovered",
          replyId: "r-discovered",
          replyUrl: "https://x.com/me/status/r-discovered",
          nowMs: Date.parse("2026-08-02T10:00:00.000Z"),
          storePath,
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
    const history = await listInteractionHistory({ storePath });
    assert.equal(history[0]?.source, "discovered");
  });
});
