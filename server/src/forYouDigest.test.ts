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
import { patchOwnPostSnapshot, upsertOwnPost } from "./ownPostStore.ts";
import type { ParsedPostCreate } from "./xActivity.ts";
import {
  FOR_YOU_MIN_POST_AGE_MS,
  MIN_T24H_SNAPSHOTS,
  countT24hSnapshots,
  filterDigestActions,
  filterExtraPosts,
  listEligibleForYouUsers,
  rankOwnPosts,
  type ForYouDigest,
} from "./forYouDigest.ts";

function post(
  partial: Partial<ParsedPostCreate> & { postId: string },
): ParsedPostCreate {
  return {
    eventUuid: partial.eventUuid ?? `evt-${partial.postId}`,
    xUserId: partial.xUserId ?? "99",
    postId: partial.postId,
    kind: partial.kind ?? "original",
    text: partial.text ?? `post ${partial.postId}`,
    postedAt: partial.postedAt ?? "2026-08-15T12:00:00.000Z",
    inReplyToId: partial.inReplyToId ?? null,
    inReplyToUserId: partial.inReplyToUserId ?? null,
    conversationId: partial.conversationId ?? null,
    authorUsername: partial.authorUsername ?? "desk",
    metrics: partial.metrics ?? { views: 10, likes: 1, replies: 0, retweets: 0, bookmarks: 0 },
  };
}

function emptyDigest(overrides: Partial<ForYouDigest> = {}): ForYouDigest {
  return {
    agenda: "Find builders",
    voice: null,
    best: [],
    worst: [],
    recentOriginals: [],
    recentReplies: [],
    recentQuotes: [],
    memories: [],
    leftoverScout: [],
    ...overrides,
  };
}

describe("forYouDigest", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-fydigest-"));
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

  it("ranks t24h snapshots and waits for a handful before eligibility", () => {
    for (let i = 1; i <= MIN_T24H_SNAPSHOTS + 1; i++) {
      upsertOwnPost({
        parsed: post({
          postId: String(i),
          kind: i === 3 ? "reply" : "original",
          postedAt: `2026-08-${10 + i}T12:00:00.000Z`,
        }),
        userId: "u1",
        tenantId: "local",
      });
      patchOwnPostSnapshot(String(i), "t24h", {
        views: i * 100,
        likes: i,
        replies: 0,
        retweets: 0,
        bookmarks: 0,
      });
    }
    assert.equal(countT24hSnapshots("u1"), MIN_T24H_SNAPSHOTS + 1);
    assert.deepEqual(
      listEligibleForYouUsers().map((u) => u.userId),
      ["u1"],
    );
    const ranked = rankOwnPosts("u1");
    assert.equal(ranked.best[0]?.id, "6");
    assert.equal(ranked.worst[0]?.id, "1");
    assert.ok(
      ranked.worst.every((w) => !ranked.best.some((b) => b.id === w.id)),
    );
    assert.ok(ranked.recentOriginals.length >= 1);
  });

  it("omits own posts younger than 1 hour from recent lists", () => {
    const now = Date.parse("2026-08-26T18:00:00.000Z");
    upsertOwnPost({
      parsed: post({
        postId: "fresh",
        text: "just posted a 26-day streak",
        postedAt: new Date(now - 10 * 60 * 1000).toISOString(),
      }),
      userId: "u1",
      tenantId: "local",
    });
    upsertOwnPost({
      parsed: post({
        postId: "settled",
        text: "yesterday's recap",
        postedAt: new Date(now - FOR_YOU_MIN_POST_AGE_MS - 60 * 1000).toISOString(),
      }),
      userId: "u1",
      tenantId: "local",
    });
    const ranked = rankOwnPosts("u1", now);
    assert.deepEqual(
      ranked.recentOriginals.map((p) => p.id),
      ["settled"],
    );
  });

  it("drops invented targets and keeps digest-grounded actions", () => {
    const digest = emptyDigest({
      best: [
        {
          id: "10",
          kind: "original",
          text: "shipped",
          url: "https://x.com/desk/status/10",
          views: 900,
          likes: 20,
          replies: 4,
          retweets: 2,
          postedAt: "2026-08-18T00:00:00.000Z",
        },
      ],
      leftoverScout: [
        {
          id: "77",
          author: "@a",
          text: "who is hiring",
          url: "https://x.com/a/status/77",
        },
      ],
    });
    const kept = filterDigestActions(
      {
        actions: [
          { kind: "post", why: "best post was 900 views", draft: "A recap." },
          {
            kind: "quote",
            why: "that 900-view post",
            draft: "Still true.",
            targetId: "10",
            targetUrl: "https://x.com/desk/status/10",
          },
          {
            kind: "reply",
            why: "open scout thread",
            targetId: "77",
            targetUrl: "https://x.com/a/status/77",
            targetAuthor: "@a",
          },
          {
            kind: "repost",
            why: "made up",
            targetId: "999",
            targetUrl: "https://x.com/nope/status/999",
          },
        ],
      },
      digest,
    );
    assert.deepEqual(
      kept.map((a) => a.kind),
      ["post", "quote", "reply"],
    );
  });

  it("rewrites first-person why and leaves the draft in their voice", () => {
    const digest = emptyDigest({
      best: [
        {
          id: "10",
          kind: "original",
          text: "shipped",
          url: "https://x.com/desk/status/10",
          views: 900,
          likes: 20,
          replies: 4,
          retweets: 2,
          postedAt: "2026-08-18T00:00:00.000Z",
        },
      ],
    });
    const kept = filterDigestActions(
      {
        actions: [
          {
            kind: "post",
            why: "My recent originals got 18 views",
            draft: "I shipped the recap.",
          },
          {
            kind: "quote",
            why: "I got 900 views on this one",
            draft: "Still true.",
            targetId: "10",
            targetUrl: "https://x.com/desk/status/10",
          },
        ],
      },
      digest,
    );
    assert.deepEqual(
      kept.map((a) => a.why),
      [
        "Your recent originals got 18 views",
        "You got 900 views on this one",
      ],
    );
    assert.equal(kept[0]?.draft, "I shipped the recap.");
  });

  it("does not let worst or thin memories be engagement targets", () => {
    const digest = emptyDigest({
      best: [
        {
          id: "10",
          kind: "original",
          text: "shipped",
          url: "https://x.com/desk/status/10",
          views: 900,
          likes: 20,
          replies: 4,
          retweets: 2,
          postedAt: "2026-08-18T00:00:00.000Z",
        },
      ],
      worst: [
        {
          id: "2",
          kind: "original",
          text: "flop",
          url: "https://x.com/desk/status/2",
          views: 2,
          likes: 0,
          replies: 0,
          retweets: 0,
          postedAt: "2026-08-17T00:00:00.000Z",
        },
      ],
      memories: [
        {
          threadId: "mem-thin",
          author: "@cizo",
          url: "https://x.com/cizo/status/3",
          views: 2,
        },
        {
          threadId: "mem-none",
          author: "@none",
          url: "https://x.com/none/status/5",
        },
        {
          threadId: "mem-ok",
          author: "@ok",
          url: "https://x.com/ok/status/4",
          views: 40,
        },
      ],
    });
    const kept = filterDigestActions(
      {
        actions: [
          {
            kind: "quote",
            why: "boost the 2-view flop",
            draft: "More of this.",
            targetId: "2",
            targetUrl: "https://x.com/desk/status/2",
          },
          {
            kind: "reply",
            why: "only 2 views so reply to boost",
            targetId: "mem-thin",
            targetUrl: "https://x.com/cizo/status/3",
          },
          {
            kind: "reply",
            why: "unsampled memory, views unknown",
            targetId: "mem-none",
            targetUrl: "https://x.com/none/status/5",
          },
          {
            kind: "reply",
            why: "40 views on a memory worth another take",
            targetId: "mem-ok",
            targetUrl: "https://x.com/ok/status/4",
          },
          {
            kind: "quote",
            why: "900 views — write the next one like this",
            draft: "Same shape.",
            targetId: "10",
            targetUrl: "https://x.com/desk/status/10",
          },
        ],
      },
      digest,
    );
    assert.deepEqual(
      kept.map((a) => a.targetId ?? a.kind),
      ["mem-ok", "10"],
    );
  });

  it("does not let thin best posts be quote/repost targets", () => {
    const digest = emptyDigest({
      best: [
        {
          id: "10",
          kind: "original",
          text: "shipped",
          url: "https://x.com/desk/status/10",
          views: 2,
          likes: 0,
          replies: 0,
          retweets: 0,
          postedAt: "2026-08-18T00:00:00.000Z",
        },
        {
          id: "11",
          kind: "original",
          text: "winner",
          url: "https://x.com/desk/status/11",
          views: 900,
          likes: 20,
          replies: 4,
          retweets: 2,
          postedAt: "2026-08-18T01:00:00.000Z",
        },
      ],
    });
    const kept = filterDigestActions(
      {
        actions: [
          {
            kind: "quote",
            why: "double down on the 2-view best post",
            draft: "No.",
            targetId: "10",
            targetUrl: "https://x.com/desk/status/10",
          },
          {
            kind: "quote",
            why: "900 views on the winner",
            draft: "Yes.",
            targetId: "11",
            targetUrl: "https://x.com/desk/status/11",
          },
        ],
      },
      digest,
    );
    assert.deepEqual(
      kept.map((a) => a.targetId ?? a.kind),
      ["11"],
    );
  });

  it("drops thin and worst-via-recent posts from recent allowlists", () => {
    const worstPost = {
      id: "2",
      kind: "original" as const,
      text: "flop",
      url: "https://x.com/desk/status/2",
      views: 12,
      likes: 0,
      replies: 0,
      retweets: 0,
      postedAt: "2026-08-17T00:00:00.000Z",
    };
    const digest = emptyDigest({
      best: [
        {
          id: "10",
          kind: "original",
          text: "shipped",
          url: "https://x.com/desk/status/10",
          views: 900,
          likes: 20,
          replies: 4,
          retweets: 2,
          postedAt: "2026-08-18T00:00:00.000Z",
        },
      ],
      worst: [worstPost],
      recentOriginals: [
        worstPost,
        {
          id: "3",
          kind: "original",
          text: "brand new",
          url: "https://x.com/desk/status/3",
          views: 2,
          likes: 0,
          replies: 0,
          retweets: 0,
          postedAt: "2026-08-19T00:00:00.000Z",
        },
        {
          id: "4",
          kind: "original",
          text: "strong recent",
          url: "https://x.com/desk/status/4",
          views: 40,
          likes: 5,
          replies: 1,
          retweets: 0,
          postedAt: "2026-08-19T01:00:00.000Z",
        },
      ],
    });
    const kept = filterDigestActions(
      {
        actions: [
          {
            kind: "quote",
            why: "revive the worst via recent",
            draft: "No.",
            targetId: "2",
            targetUrl: "https://x.com/desk/status/2",
          },
          {
            kind: "quote",
            why: "2-view new post",
            draft: "No.",
            targetId: "3",
            targetUrl: "https://x.com/desk/status/3",
          },
          {
            kind: "repost",
            why: "40-view strong recent",
            targetId: "4",
            targetUrl: "https://x.com/desk/status/4",
          },
          {
            kind: "quote",
            why: "900 views — keep the winner",
            draft: "Yes.",
            targetId: "10",
            targetUrl: "https://x.com/desk/status/10",
          },
        ],
      },
      digest,
    );
    assert.deepEqual(
      kept.map((a) => a.targetId ?? a.kind),
      ["4", "10"],
    );
  });

  it("keeps three unique extra originals and drops other kinds", () => {
    const kept = filterExtraPosts({
      actions: [
        { kind: "reply", why: "scout", draft: "hey", targetId: "77" },
        { kind: "post", why: "900 views", draft: "What would you cut?" },
        { kind: "post", why: "900 views", draft: "What would you cut?" },
        { kind: "post", why: "4 replies", draft: "Is the other side wrong?" },
        { kind: "post", why: "20 likes", draft: "I'll take the under." },
        { kind: "post", why: "extra", draft: "Fourth should drop." },
      ],
    });
    assert.deepEqual(
      kept.map((a) => a.draft),
      [
        "What would you cut?",
        "Is the other side wrong?",
        "I'll take the under.",
      ],
    );
  });
});
