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
import { updateUserAgenda } from "./authStore.ts";
import { upsertOauthUser } from "./oauthAccountStore.ts";
import type { ParsedPostCreate } from "./xActivity.ts";
import { MIN_T24H_SNAPSHOTS } from "./forYouDigest.ts";
import {
  hasForYouRunToday,
  listActiveSuggestions,
} from "./forYouStore.ts";
import { runForYouDigestForUser } from "./forYouRun.ts";
import type { ChatFn } from "./voiceLlm.ts";

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

function seedSnapshots(
  userId: string,
  n: number,
  withAgenda = true,
): void {
  upsertOauthUser({
    provider: "google",
    providerUserId: `test-${userId}`,
    email: `${userId}@example.com`,
    emailVerified: true,
  });
  if (withAgenda) updateUserAgenda(userId, "Find builders shipping AI tools");
  for (let i = 1; i <= n; i++) {
    upsertOwnPost({
      parsed: post({ postId: `${userId}-${i}` }),
      userId,
      tenantId: "local",
    });
    patchOwnPostSnapshot(`${userId}-${i}`, "t24h", {
      views: i * 80,
      likes: i,
      replies: 1,
      retweets: 0,
      bookmarks: 0,
    });
  }
}

const chat: ChatFn = async () => ({
  ok: true,
  content: JSON.stringify({
    actions: [
      { kind: "post", why: "hiring thread is live", draft: "Who is hiring this week?" },
      {
        kind: "quote",
        why: "quote the winner",
        draft: "still the move",
        targetId: "u1-5",
        targetUrl: "https://x.com/desk/status/u1-5",
      },
      {
        kind: "quote",
        why: "quote the winner",
        draft: "still the move",
        targetId: "u2-5",
        targetUrl: "https://x.com/desk/status/u2-5",
      },
    ],
  }),
  model: "deepseek-v4-flash",
  provider: "deepseek",
});

describe("runForYouDigestForUser", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-fyrun-"));
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

  it("skips thin accounts and no-ops a second run the same UTC day", async () => {
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    seedSnapshots("u1", 2);
    const thin = await runForYouDigestForUser({
      userId: "u1",
      tenantId: "local",
      nowMs: now,
      chat,
    });
    assert.equal(thin.reason, "thin");

    seedSnapshots("u1", MIN_T24H_SNAPSHOTS);
    const first = await runForYouDigestForUser({
      userId: "u1",
      tenantId: "local",
      nowMs: now,
      chat,
      getScout: async () => ({ threads: [] }),
    });
    assert.equal(first.reason, "ok");
    assert.ok(first.wrote >= 1);
    assert.ok(listActiveSuggestions("u1", now + 1000).length >= 1);

    const again = await runForYouDigestForUser({
      userId: "u1",
      tenantId: "local",
      nowMs: now + 3600_000,
      chat,
    });
    assert.equal(again.reason, "already_ran");
  });

  it("drops remix posts while keeping valid actions", async () => {
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    seedSnapshots("u1", MIN_T24H_SNAPSHOTS);
    let calls = 0;
    const singleChat: ChatFn = async () => ({
      ok: true,
      content: JSON.stringify({
        actions:
          calls++ === 0
            ? [
                { kind: "post", why: "top post did 400 views", draft: "Ship a recap." },
                { kind: "post", why: "hiring thread is live", draft: "Who is hiring this week?" },
              ]
            : [
                { kind: "post", why: "hiring thread is live", draft: "Who is hiring this week?" },
                {
                  kind: "quote",
                  why: "quote the winner",
                  draft: "still the move",
                  targetId: "u1-5",
                  targetUrl: "https://x.com/desk/status/u1-5",
                },
              ],
      }),
      model: "deepseek-v4-flash",
      provider: "deepseek",
    });
    const result = await runForYouDigestForUser({
      userId: "u1",
      tenantId: "local",
      nowMs: now,
      chat: singleChat,
      getScout: async () => ({ threads: [] }),
    });
    assert.equal(result.reason, "ok");
    const suggestions = listActiveSuggestions("u1", now + 1000);
    assert.equal(result.wrote, 2);
    assert.equal(suggestions.length, 2);
    assert.ok(suggestions.every((suggestion) => !suggestion.why.includes("400 views")));
    assert.equal(hasForYouRunToday("u1", now), true);
  });

  it("does not record an empty Scout pass and retries when data arrives", async () => {
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    seedSnapshots("u2", MIN_T24H_SNAPSHOTS, false);
    const empty = await runForYouDigestForUser({
      userId: "u2",
      tenantId: "local",
      nowMs: now,
      chat,
      getScout: async () => ({ threads: [] }),
    });
    assert.equal(empty.reason, "empty");
    assert.equal(hasForYouRunToday("u2", now), false);

    updateUserAgenda("u2", "Find builders shipping AI tools");
    const retried = await runForYouDigestForUser({
      userId: "u2",
      tenantId: "local",
      nowMs: now + 3600_000,
      chat,
      getScout: async () => ({
        threads: [
          {
            id: "thread-1",
            author: "builder",
            text: "AI tools are changing how teams ship",
            url: "https://x.com/builder/status/thread-1",
          },
        ],
      }),
    });
    assert.equal(retried.reason, "ok");
  });

  it("does not burn the daily run on an LLM failure; retries next tick", async () => {
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    seedSnapshots("u1", MIN_T24H_SNAPSHOTS);
    const failingChat: ChatFn = async () => ({
      ok: false,
      status: 503,
      error: "upstream",
      message: "DeepSeek unavailable",
    });
    const failed = await runForYouDigestForUser({
      userId: "u1",
      tenantId: "local",
      nowMs: now,
      chat: failingChat,
      getScout: async () => ({ threads: [] }),
    });
    assert.equal(failed.wrote, 0);
    assert.equal(failed.reason, "llm_error");
    assert.equal(hasForYouRunToday("u1", now), false);

    const retried = await runForYouDigestForUser({
      userId: "u1",
      tenantId: "local",
      nowMs: now + 3600_000,
      chat,
      getScout: async () => ({ threads: [] }),
    });
    assert.equal(retried.reason, "ok");
  });
});
