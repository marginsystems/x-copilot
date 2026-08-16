import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { listIngestUsers, upsertOauthUser } from "./authStore.ts";
import { getVoiceProfile } from "./voiceStore.ts";
import { VOICE_TARGET_REPLIES } from "./voiceIngest.ts";
import { runUserIngest } from "./userIngest.ts";

describe("runUserIngest", () => {
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

  it("initial pull stores replies and advances the cursor", async () => {
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
        foldLocal: async () => {},
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
            newestId: "r1",
            pages: 1,
            completed: true,
          };
        },
        generateCard: async () => ({
          ok: false,
          error: "skip",
          message: "under bar",
        }),
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.pulled, 1);
    assert.equal(result.unlocked, false);
    const profile = getVoiceProfile(user.id);
    assert.equal(profile?.sinceId, "r1");
    assert.equal(profile?.xUserId, "99");
  });

  it("hourly pull uses the stored since_id", async () => {
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
        foldLocal: async () => {},
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
          newestId: "r1",
          pages: 1,
          completed: true,
        }),
        generateCard: async () => ({
          ok: false,
          error: "skip",
          message: "under bar",
        }),
      },
    });
    let seenSince: string | null | undefined;
    await runUserIngest({
      user,
      mode: "hourly",
      deps: {
        foldLocal: async () => {},
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
            newestId: "r1",
            pages: 1,
            completed: true,
          };
        },
        generateCard: async () => ({
          ok: false,
          error: "skip",
          message: "under bar",
        }),
      },
    });
    assert.equal(seenSince, "r1");
  });

  it("hourly pull with no cursor targets the full corpus", async () => {
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
        foldLocal: async () => {},
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
            newestId: "r1",
            pages: 1,
            completed: true,
          };
        },
        generateCard: async () => ({
          ok: false,
          error: "skip",
          message: "under bar",
        }),
      },
    });
    assert.equal(target, VOICE_TARGET_REPLIES);
  });

  it("initial pull that unlocks writes the voice card so Suggest opens", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    const replies = Array.from({ length: 100 }, (_, i) => ({
      id: `r${i}`,
      text: `public reply ${i}`,
      conversationId: `c${i}`,
      inReplyToId: `p${i}`,
      postedAt: "2026-08-16T10:00:00.000Z",
      source: "api" as const,
    }));
    let cardCalls = 0;
    const result = await runUserIngest({
      user,
      mode: "initial",
      deps: {
        foldLocal: async () => {},
        resolveUser: async () => ({
          ok: true,
          id: "99",
          username: "me",
          protected: false,
        }),
        pullReplies: async () => ({
          ok: true,
          replies,
          newestId: "r99",
          pages: 1,
          completed: true,
        }),
        generateCard: async () => {
          cardCalls += 1;
          return {
            ok: true,
            card: {
              tone: "dry",
              typicalLength: "short",
              habits: [],
              neverDo: [],
              examples: ["a", "b", "c"],
            },
            cardJson: JSON.stringify({ tone: "dry" }),
            model: "test-model",
          };
        },
      },
    });
    assert.equal(result.unlocked, true);
    assert.equal(cardCalls, 1);
    const profile = getVoiceProfile(user.id);
    assert.equal(profile?.status, "ready");
    assert.notEqual(profile?.cardJson, null);
  });

  it("a slower concurrent run cannot wedge a card-holder back to empty", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    const replies = Array.from({ length: 100 }, (_, i) => ({
      id: `r${i}`,
      text: `public reply ${i}`,
      conversationId: `c${i}`,
      inReplyToId: `p${i}`,
      postedAt: "2026-08-16T10:00:00.000Z",
      source: "api" as const,
    }));
    const cardOk = {
      ok: true as const,
      card: {
        tone: "dry",
        typicalLength: "short",
        habits: [],
        neverDo: [],
        examples: ["a", "b", "c"],
      },
      cardJson: JSON.stringify({ tone: "dry" }),
      model: "test-model",
    };
    let releaseSlow: (() => void) | null = null;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const common = {
      foldLocal: async () => {},
      resolveUser: async () => ({
        ok: true as const,
        id: "99",
        username: "me",
        protected: false,
      }),
      generateCard: async () => cardOk,
    };
    const slowRun = runUserIngest({
      user,
      mode: "initial",
      deps: {
        ...common,
        pullReplies: async () => {
          await slowGate;
          return {
            ok: true,
            replies: [],
            newestId: "r0",
            pages: 1,
            completed: true,
          };
        },
      },
    });
    const fastRun = runUserIngest({
      user,
      mode: "initial",
      deps: {
        ...common,
        pullReplies: async () => ({
          ok: true,
          replies,
          newestId: "r99",
          pages: 1,
          completed: true,
        }),
      },
    });
    await fastRun;
    releaseSlow?.();
    await slowRun;
    const profile = getVoiceProfile(user.id);
    assert.equal(profile?.status, "ready");
    assert.notEqual(profile?.cardJson, null);
  });

  it("listIngestUsers prepares and returns rotation-eligible users", () => {
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

  it("fail path stamps last_pull_at so failing users demote in rotation", async () => {
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
        foldLocal: async () => {},
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
});
