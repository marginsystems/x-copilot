import { stringRow } from "../platform/unknownValue.js";
import { expectRecord } from "../http/http.testHelpers.js";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "../db.ts";
import {
  getUserById,
  listIngestUsers,
  setUserXUsername,
} from "../auth/authStore.ts";
import {
  linkOauthToUser,
  upsertOauthUser,
} from "../auth/oauthAccountStore.ts";
import {
  getXOauthUsername,
  getXOauthXUserId,
} from "../auth/xIdentityStore.ts";
import {
  ensureVoiceProfile,
  getVoiceProfile,
  updateVoiceProfilePull,
  upsertVoiceReplies,
} from "./voiceStore.ts";
import { VOICE_TARGET_REPLIES } from "./voiceIngest.ts";
import { beginVoiceCorpus, confirmRecentOwnPosts, runUserIngest } from "./userIngest.ts";
import { getXProfiles, listCircleLinks } from "../circle/circleStore.ts";
import { listConfirmedOwnRepliesPage } from "../desk/ownPostStore.ts";

await describe("runUserIngest", async () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-ingest-"));
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

  await it("initial pull stores replies and advances the cursor", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    const result = await runUserIngest({
      user,
      mode: "initial",
      deps: {
        resolveUser: async () => ({
          ok: true,
          id: "99",
          username: "me",
          protected: false,
        }),
        pullReplies: async (opts) => {
          assert.equal(opts.sinceId ?? null, null);
          return {
            ok: true,
            replies: [
              {
                id: "r1",
                text: "public reply",
                conversationId: "c1",
                inReplyToId: "p1",
                postedAt: "2026-08-16T10:00:00.000Z",
                source: "api",
              },
            ],
            profiles: [],
            newestId: "r1",
            pages: 1,
            completed: true,
          };
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.pulled, 1);
    const profile = getVoiceProfile(user.id);
    assert.equal(profile?.sinceId, "r1");
    assert.equal(profile?.xUserId, "99");
  });

  await it("records circle profiles and links from the pull, skipping self", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    await runUserIngest({
      user,
      mode: "initial",
      deps: {
        resolveUser: async () => ({ ok: true, id: "99", username: "me", protected: false }),
        pullReplies: async () => ({
          ok: true,
          replies: [
            {
              id: "r1",
              text: "reply to alice",
              inReplyToId: "p1",
              inReplyToUserId: "77",
              postedAt: "2026-08-16T10:00:00.000Z",
              source: "api",
              kind: "reply",
              circleTarget: { authorKey: "alice", kind: "reply" },
            },
            {
              id: "q1",
              text: "quoting bob",
              postedAt: "2026-08-16T11:00:00.000Z",
              source: "api",
              kind: "quote",
              circleTarget: { authorKey: "bob", kind: "quote" },
            },
            {
              id: "s1",
              text: "self thread",
              inReplyToId: "r0",
              inReplyToUserId: "99",
              postedAt: "2026-08-16T12:00:00.000Z",
              source: "api",
              kind: "reply",
              circleTarget: { authorKey: "me", kind: "reply" },
            },
          ],
          profiles: [
            {
              authorKey: "alice",
              handle: "Alice",
              name: "Alice A",
              avatarUrl: "https://pbs.twimg.com/a_400x400.jpg",
              updatedAt: "2026-08-16T12:00:00.000Z",
            },
          ],
          newestId: "s1",
          pages: 1,
          completed: true,
        }),
      },
    });
    assert.deepEqual(listCircleLinks(user.id), [
      { postId: "q1", authorKey: "bob", kind: "quote", at: "2026-08-16T11:00:00.000Z" },
      { postId: "r1", authorKey: "alice", kind: "reply", at: "2026-08-16T10:00:00.000Z" },
    ]);
    assert.equal(getXProfiles(["alice"]).get("alice")?.name, "Alice A");
    const row = expectRecord(getPlatformDb()
      .prepare(`SELECT in_reply_to_user_id FROM own_posts WHERE user_id = ? AND id = ?`)
      .get(user.id, "r1"));
    assert.equal(row.in_reply_to_user_id, "77");
  });

  await it("updates reply targets when a pull re-ingests an existing own post", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    const ingestReply = (inReplyToUserId: string | null) =>
      runUserIngest({
        user,
        mode: "initial",
        deps: {
          resolveUser: async () => ({
            ok: true,
            id: "99",
            username: "me",
            protected: false,
          }),
          pullReplies: async () => ({
            ok: true,
            replies: [
              {
                id: "existing-reply",
                text: "self-thread reply",
                inReplyToId: "parent-post",
                inReplyToUserId,
                postedAt: "2026-08-16T10:00:00.000Z",
                source: "api" as const,
                kind: "reply" as const,
              },
            ],
            profiles: [],
            newestId: "existing-reply",
            pages: 1,
            completed: true,
          }),
        },
      });

    await ingestReply(null);
    assert.equal(
      listConfirmedOwnRepliesPage({
        userId: user.id,
        limit: 10,
        excludeSelfReplies: true,
      }).length,
      1,
    );

    await ingestReply("99");
    const row = expectRecord(getPlatformDb()
      .prepare(
        `SELECT in_reply_to_user_id FROM own_posts WHERE user_id = ? AND id = ?`,
      )
      .get(user.id, "existing-reply"));
    assert.equal(row.in_reply_to_user_id, "99");
    assert.deepEqual(
      listConfirmedOwnRepliesPage({
        userId: user.id,
        limit: 10,
        excludeSelfReplies: true,
      }),
      [],
    );
  });

  await it("hourly pull uses the stored since_id", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    await runUserIngest({
      user,
      mode: "initial",
      deps: {
        resolveUser: async () => ({
          ok: true,
          id: "99",
          username: "me",
          protected: false,
        }),
        pullReplies: async () => ({
          ok: true,
          replies: [
            {
              id: "r1",
              text: "first",
              conversationId: "c1",
              inReplyToId: "p1",
              postedAt: "2026-08-16T10:00:00.000Z",
              source: "api",
            },
          ],
          profiles: [],
          newestId: "r1",
          pages: 1,
          completed: true,
        }),
      },
    });
    let seenSince: string | null | undefined;
    await runUserIngest({
      user,
      mode: "hourly",
      deps: {
        resolveUser: async () => ({
          ok: true,
          id: "99",
          username: "me",
          protected: false,
        }),
        pullReplies: async (opts) => {
          seenSince = opts.sinceId ?? null;
          return {
            ok: true,
            replies: [],
            profiles: [],
            newestId: "r1",
            pages: 1,
            completed: true,
          };
        },
      },
    });
    assert.equal(seenSince, "r1");
  });

  await it("hourly pull with no cursor targets the full corpus", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    let target: number | undefined;
    await runUserIngest({
      user,
      mode: "hourly",
      deps: {
        resolveUser: async () => ({
          ok: true,
          id: "99",
          username: "me",
          protected: false,
        }),
        pullReplies: async (opts) => {
          target = opts.targetReplies;
          return {
            ok: true,
            replies: [],
            profiles: [],
            newestId: "r1",
            pages: 1,
            completed: true,
          };
        },
      },
    });
    assert.equal(target, VOICE_TARGET_REPLIES);
  });

  await it("listIngestUsers prepares and returns rotation-eligible users", () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    const users = listIngestUsers();
    assert.equal(users.length, 1);
    assert.equal(users[0].id, user.id);
    assert.equal(users[0].xUsername, "me");
  });

  await it("listIngestUsers skips users without a linked X account", () => {
    const google = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-memory-only",
      email: "memory-only@example.com",
      emailVerified: true,
    });
    ensureVoiceProfile(google.id, "local");
    upsertVoiceReplies(
      google.id,
      Array.from({ length: 120 }, (_, i) => ({
        id: `mem-${i}`,
        text: `memory reply ${i}`,
      })),
    );
    updateVoiceProfilePull({ userId: google.id, xUsername: null });
    assert.deepEqual(listIngestUsers(), []);
  });

  await it("listIngestUsers serves never-pulled users first, then the oldest pull", () => {
    const users = ["a", "b", "c"].map((handle, i) =>
      upsertOauthUser({
        provider: "x",
        providerUserId: String(100 + i),
        emailVerified: false,
        username: handle,
      }),
    );
    for (const [user, lastPullAt] of [
      [users[0]!, "2026-08-16T12:00:00.000Z"],
      [users[1]!, "2026-08-16T09:00:00.000Z"],
    ] as const) {
      ensureVoiceProfile(user.id, "local");
      updateVoiceProfilePull({ userId: user.id, xUsername: null, lastPullAt });
    }
    assert.deepEqual(
      listIngestUsers().map((user) => user.id),
      [users[2]!.id, users[1]!.id, users[0]!.id],
    );
  });

  await it("fail path stamps last_pull_at so failing users demote in rotation", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    const result = await runUserIngest({
      user,
      mode: "hourly",
      deps: {
        resolveUser: async () => ({
          ok: true,
          id: "99",
          username: "me",
          protected: true,
        }),
      },
    });
    assert.equal(result.ok, false);
    assert.notEqual(getVoiceProfile(user.id)?.lastPullAt, null);
  });

  await it("folds a null-postedAt reply with a fallback now that a real timestamp corrects on re-ingest", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    const deps = (
      replies: Array<{ id: string; text: string; postedAt?: string | null }>,
    ) => ({
      resolveUser: async () => ({
        ok: true as const,
        id: "99",
        username: "me",
        protected: false,
      }),
      pullReplies: async () => ({
        ok: true as const,
        replies: replies.map((r) => ({
          ...r,
          conversationId: "c1",
          source: "api" as const,
        })),
        profiles: [],
        newestId: replies[0]?.id ?? "r1",
        pages: 1,
        completed: true,
      }),
    });

    const before = Date.now();
    await runUserIngest({
      user,
      mode: "initial",
      deps: deps([{ id: "r-no-date", text: "no timestamp" }]),
    });
    const fallbackRow = stringRow(getPlatformDb()
      .prepare(`SELECT posted_at FROM own_posts WHERE id = ?`)
      .get("r-no-date"), "posted_at");
    const fallbackMs = Date.parse(fallbackRow.posted_at);
    assert.ok(Number.isFinite(fallbackMs));
    assert.ok(fallbackMs >= before, "fallback posted_at should be ≈ now");
    assert.ok(fallbackMs <= Date.now(), "fallback posted_at should be ≈ now");

    await runUserIngest({
      user,
      mode: "initial",
      deps: deps([
        {
          id: "r-no-date",
          text: "no timestamp",
          postedAt: "2026-08-16T10:00:00.000Z",
        },
      ]),
    });
    const repaired = stringRow(getPlatformDb()
      .prepare(`SELECT posted_at FROM own_posts WHERE id = ?`)
      .get("r-no-date"), "posted_at");
    assert.equal(repaired.posted_at, "2026-08-16T10:00:00.000Z");
  });
});

await describe("beginVoiceCorpus", async () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-corpus-"));
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

  await it("starts an initial pull on first X link", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    let ingestCalls = 0;
    let subscribeCalls = 0;
    const result = await beginVoiceCorpus({
      user,
      reason: "x_oauth",
      deps: {
        ingest: async () => {
          ingestCalls += 1;
          return {
            ok: true,
            userId: user.id,
            pulled: 12,
            ownPostsIngested: 0,
          };
        },
        subscribe: async () => {
          subscribeCalls += 1;
        },
        allow: () => true,
      },
    });
    assert.equal(ingestCalls, 1);
    assert.equal(subscribeCalls, 1);
    assert.equal(result?.pulled, 12);
  });

  await it("skips a repeat pull when a cursor already exists", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    await runUserIngest({
      user,
      mode: "initial",
      deps: {
        resolveUser: async () => ({
          ok: true,
          id: "99",
          username: "me",
          protected: false,
        }),
        pullReplies: async () => ({
          ok: true,
          replies: [
            {
              id: "1",
              text: "hi",
              postedAt: "2026-08-17T00:00:00.000Z",
              conversationId: "c1",
              source: "api",
            },
          ],
          profiles: [],
          newestId: "1",
          pages: 1,
          completed: true,
        }),
      },
    });
    assert.equal(getVoiceProfile(user.id)?.sinceId, "1");
    let ingestCalls = 0;
    let subscribeCalls = 0;
    await beginVoiceCorpus({
      user,
      reason: "x_oauth",
      deps: {
        ingest: async () => {
          ingestCalls += 1;
          return {
            ok: true,
            userId: user.id,
            pulled: 0,
            ownPostsIngested: 0,
          };
        },
        subscribe: async () => {
          subscribeCalls += 1;
        },
        allow: () => true,
      },
    });
    assert.equal(ingestCalls, 0);
    // The repeat login skips the pull but still keeps the live subscribe.
    assert.equal(subscribeCalls, 1);
  });

  await it("repoints the corpus when OAuth links a different account than the typed handle", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "B",
      emailVerified: false,
      username: "b",
    });
    const typed = setUserXUsername(user.id, "a");
    assert.equal(typed?.xUsername, "a");
    ensureVoiceProfile(user.id, "local");
    updateVoiceProfilePull({
      userId: user.id,
      xUsername: "a",
      xUserId: "A",
      sinceId: "old",
    });
    let ingestCalls = 0;
    let subscribeCalls = 0;
    await beginVoiceCorpus({
      user: typed!,
      reason: "x_oauth",
      deps: {
        ingest: async () => {
          ingestCalls += 1;
          return {
            ok: true,
            userId: user.id,
            pulled: 5,
            ownPostsIngested: 0,
          };
        },
        subscribe: async () => {
          subscribeCalls += 1;
        },
        allow: () => true,
      },
    });
    assert.equal(ingestCalls, 1);
    assert.equal(subscribeCalls, 1);
    // The old typed-account corpus is dropped so the linked account refills fresh.
    assert.equal(getVoiceProfile(user.id)?.sinceId, null);
    assert.equal(getVoiceProfile(user.id)?.xUserId, null);
  });

  await it("forces a fresh pull after an account change", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    ensureVoiceProfile(user.id, "local");
    updateVoiceProfilePull({
      userId: user.id,
      xUsername: "me",
      xUserId: "99",
      sinceId: "old",
      lastPullAt: "2026-08-17T00:00:00.000Z",
    });
    assert.equal(getVoiceProfile(user.id)?.sinceId, "old");
    let ingestCalls = 0;
    await beginVoiceCorpus({
      user,
      reason: "x_username",
      force: true,
      deps: {
        ingest: async () => {
          ingestCalls += 1;
          return {
            ok: true,
            userId: user.id,
            pulled: 3,
            ownPostsIngested: 0,
          };
        },
        subscribe: async () => {},
        allow: () => true,
      },
    });
    assert.equal(ingestCalls, 1);
  });

  await it("resolves the most recently linked X account for the OAuth identity", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-oauth-order",
      email: "order@example.com",
      emailVerified: true,
    });
    linkOauthToUser({
      userId: user.id,
      provider: "x",
      providerUserId: "B",
      username: "b",
    });
    await new Promise((r) => setTimeout(r, 5));
    linkOauthToUser({
      userId: user.id,
      provider: "x",
      providerUserId: "C",
      username: "c",
    });
    assert.equal(getXOauthXUserId(user.id), "C");
    assert.equal(getXOauthUsername(user.id), "c");
  });

  await it("re-linking an earlier X account resolves as the most recent login", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-relink",
      email: "relink@example.com",
      emailVerified: true,
    });
    linkOauthToUser({
      userId: user.id,
      provider: "x",
      providerUserId: "B",
      username: "b",
    });
    await new Promise((r) => setTimeout(r, 5));
    linkOauthToUser({
      userId: user.id,
      provider: "x",
      providerUserId: "C",
      username: "c",
    });
    await new Promise((r) => setTimeout(r, 5));
    linkOauthToUser({
      userId: user.id,
      provider: "x",
      providerUserId: "B",
      username: "b",
    });
    assert.equal(getXOauthXUserId(user.id), "B");
    assert.equal(getXOauthUsername(user.id), "b");
  });

  await it("hourly ingest after an OAuth repoint follows the linked account, not the stale typed handle", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-hourly",
      email: "hourly@example.com",
      emailVerified: true,
    });
    setUserXUsername(user.id, "a");
    ensureVoiceProfile(user.id, "local");
    updateVoiceProfilePull({
      userId: user.id,
      xUsername: "a",
      xUserId: "A",
      sinceId: "old-a",
    });
    const linked = linkOauthToUser({
      userId: user.id,
      provider: "x",
      providerUserId: "B",
      username: "b",
    });
    assert.equal(linked.ok, true);
    if (!linked.ok) return;
    await beginVoiceCorpus({
      user: linked.user,
      reason: "x_oauth",
      deps: {
        ingest: async () => ({
          ok: true,
          userId: user.id,
          pulled: 5,
          ownPostsIngested: 0,
        }),
        subscribe: async () => {},
        allow: () => true,
      },
    });
    assert.equal(getXOauthXUserId(user.id), "B");
    assert.equal(getUserById(user.id)?.xUsername, "b");
    let resolvedHandle: string | undefined;
    await runUserIngest({
      user: getUserById(user.id)!,
      mode: "hourly",
      deps: {
        resolveUser: async (handle) => {
          resolvedHandle = handle;
          return { ok: true, id: "B", username: "b", protected: false };
        },
        pullReplies: async () => ({
          ok: true,
          replies: [],
          profiles: [],
          newestId: "old-b",
          pages: 1,
          completed: true,
        }),
      },
    });
    assert.equal(resolvedHandle, "b");
  });

  await it("does nothing without a handle", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid",
      email: "g@example.com",
      emailVerified: true,
    });
    let ingestCalls = 0;
    const result = await beginVoiceCorpus({
      user,
      reason: "onboarding",
      deps: {
        ingest: async () => {
          ingestCalls += 1;
          return {
            ok: true,
            userId: user.id,
            pulled: 0,
            ownPostsIngested: 0,
          };
        },
        subscribe: async () => {},
        allow: () => true,
      },
    });
    assert.equal(result, null);
    assert.equal(ingestCalls, 0);
  });
});

await describe("confirmRecentOwnPosts", async () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-confirm-"));
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

  await it("folds a quote and leaves the hourly since_id alone", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    const result = await confirmRecentOwnPosts({
      userId: user.id,
      deps: {
        resolveUser: async () => ({
          ok: true,
          id: "99",
          username: "me",
          protected: false,
        }),
        pullReplies: async (opts) => {
          assert.equal(opts.targetReplies, 5);
          assert.equal(opts.sinceId ?? null, null);
          return {
            ok: true,
            replies: [
              {
                id: "q1",
                text: "sharper",
                kind: "quote",
                postedAt: new Date().toISOString(),
                source: "api",
              },
            ],
            profiles: [],
            newestId: "q1",
            pages: 1,
            completed: true,
          };
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.ingested, 1);
    assert.equal(getVoiceProfile(user.id)?.sinceId ?? null, null);
    const row = expectRecord(getPlatformDb()
      .prepare(
        `SELECT kind FROM own_posts WHERE user_id = ? AND id = ?`,
      )
      .get(user.id, "q1"));
    assert.equal(row?.kind, "quote");
  });

  await it("coalesces concurrent confirmations for a user", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    let resolves = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const opts = {
      userId: user.id,
      deps: {
        resolveUser: async () => {
          resolves += 1;
          await blocked;
          return {
            ok: false as const,
            status: 503,
            error: "blocked",
            message: "blocked",
          };
        },
      },
    };
    const first = confirmRecentOwnPosts(opts);
    const second = confirmRecentOwnPosts(opts);
    assert.strictEqual(first, second);
    release();
    await first;
    assert.equal(resolves, 1);
  });

  await it("skips a fresh sequential confirmation", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    let resolves = 0;
    const opts = {
      userId: user.id,
      deps: {
        resolveUser: async () => {
          resolves += 1;
          return { ok: false as const, status: 503, error: "upstream", message: "upstream" };
        },
      },
    };
    await confirmRecentOwnPosts(opts);
    await confirmRecentOwnPosts(opts);
    assert.equal(resolves, 1);
  });
});
