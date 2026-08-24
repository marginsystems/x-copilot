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
import {
  getUserById,
  listIngestUsers,
  setUserXUsername,
} from "./authStore.ts";
import {
  linkOauthToUser,
  upsertOauthUser,
} from "./oauthAccountStore.ts";
import {
  getXOauthUsername,
  getXOauthXUserId,
} from "./xIdentityStore.ts";
import {
  ensureVoiceProfile,
  getVoiceProfile,
  saveVoiceCard,
  updateVoiceProfilePull,
  upsertVoiceReplies,
} from "./voiceStore.ts";
import { VOICE_TARGET_REPLIES } from "./voiceIngest.ts";
import { beginVoiceCorpus, runUserIngest } from "./userIngest.ts";

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

  /** An unlocked profile whose card was written at `cardUpdatedAt`. */
  function seedUnlockedCard(userId: string, cardUpdatedAt?: string) {
    ensureVoiceProfile(userId, "local");
    upsertVoiceReplies(
      userId,
      Array.from({ length: 100 }, (_, i) => ({
        id: `seed-${i}`,
        text: `seed post ${i}`,
        conversationId: `c${i}`,
        postedAt: "2026-08-10T10:00:00.000Z",
        source: "api" as const,
      })),
    );
    updateVoiceProfilePull({
      userId,
      xUsername: "me",
      xUserId: "99",
      sinceId: "seed-99",
      lastPullAt: "2026-08-10T10:00:00.000Z",
    });
    saveVoiceCard({ userId, cardJson: '{"tone":"old"}', model: "m" });
    if (cardUpdatedAt) {
      getPlatformDb()
        .prepare(
          `UPDATE voice_profiles SET card_updated_at = ?, card_attempt_at = ?
           WHERE user_id = ?`,
        )
        .run(cardUpdatedAt, cardUpdatedAt, userId);
    }
  }

  type CardResult =
    | {
        ok: true;
        card: {
          tone: string;
          typicalLength: string;
          habits: string[];
          neverDo: string[];
          examples: string[];
        };
        cardJson: string;
        model: string;
      }
    | { ok: false; error: string; message: string };

  function hourlyDeps(opts: {
    replies: Array<{ id: string; text: string }>;
    onCard: () => CardResult;
  }) {
    return {
      foldLocal: async () => {},
      resolveUser: async () => ({
        ok: true as const,
        id: "99",
        username: "me",
        protected: false,
      }),
      pullReplies: async () => ({
        ok: true as const,
        replies: opts.replies.map((r) => ({
          ...r,
          conversationId: `c-${r.id}`,
          inReplyToId: null,
          postedAt: "2026-08-24T10:00:00.000Z",
          source: "api" as const,
        })),
        newestId: opts.replies[0]?.id ?? "seed-99",
        pages: 1,
        completed: true,
      }),
      generateCard: async () => opts.onCard(),
    };
  }

  const staleIso = () =>
    new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const newCard = () => ({
    ok: true as const,
    card: {
      tone: "new",
      typicalLength: "short",
      habits: [],
      neverDo: [],
      examples: ["a", "b", "c"],
    },
    cardJson: '{"tone":"new"}',
    model: "test-model",
  });

  it("hourly ingest rewrites a >24h-old card when the pull adds posts", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    seedUnlockedCard(user.id, staleIso());
    let cardCalls = 0;
    const result = await runUserIngest({
      user,
      mode: "hourly",
      deps: hourlyDeps({
        replies: [{ id: "new-1", text: "fresh post" }],
        onCard: () => {
          cardCalls += 1;
          return newCard();
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(cardCalls, 1);
    const profile = getVoiceProfile(user.id);
    assert.equal(profile?.cardJson, '{"tone":"new"}');
    assert.equal(profile?.status, "ready");
    assert.ok(
      Date.now() - Date.parse(profile?.cardUpdatedAt ?? "") < 60_000,
      "the rewrite must stamp a fresh card_updated_at",
    );
  });

  it("hourly ingest leaves a fresh card alone even when posts arrive", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    seedUnlockedCard(user.id);
    let cardCalls = 0;
    await runUserIngest({
      user,
      mode: "hourly",
      deps: hourlyDeps({
        replies: [{ id: "new-1", text: "fresh post" }],
        onCard: () => {
          cardCalls += 1;
          return newCard();
        },
      }),
    });
    assert.equal(cardCalls, 0);
    assert.equal(getVoiceProfile(user.id)?.cardJson, '{"tone":"old"}');
  });

  it("hourly ingest does not rewrite a stale card when nothing new arrived", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    seedUnlockedCard(user.id, staleIso());
    let cardCalls = 0;
    await runUserIngest({
      user,
      mode: "hourly",
      deps: hourlyDeps({
        replies: [],
        onCard: () => {
          cardCalls += 1;
          return newCard();
        },
      }),
    });
    assert.equal(cardCalls, 0);
    assert.equal(getVoiceProfile(user.id)?.cardJson, '{"tone":"old"}');
  });

  it("hourly ingest does not rewrite a stale card when a pull returns only duplicates", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    seedUnlockedCard(user.id, staleIso());
    let cardCalls = 0;
    const result = await runUserIngest({
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
        pullReplies: async () => ({
          ok: true,
          // The truncated pull re-returns already-stored posts and does not
          // advance the cursor — the realistic no-growth shape.
          replies: Array.from({ length: 100 }, (_, i) => ({
            id: `seed-${i}`,
            text: `seed post ${i}`,
            conversationId: `c${i}`,
            inReplyToId: null,
            postedAt: "2026-08-10T10:00:00.000Z",
            source: "api" as const,
          })),
          newestId: "seed-99",
          pages: 1,
          completed: false,
        }),
        generateCard: async () => {
          cardCalls += 1;
          return newCard();
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(cardCalls, 0);
    assert.equal(getVoiceProfile(user.id)?.cardJson, '{"tone":"old"}');
  });

  it("a failed hourly rewrite is stamped so the next pass does not retry the same day", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    seedUnlockedCard(user.id, staleIso());
    let cardCalls = 0;
    const first = await runUserIngest({
      user,
      mode: "hourly",
      deps: hourlyDeps({
        replies: [{ id: "new-1", text: "fresh post" }],
        onCard: () => {
          cardCalls += 1;
          return {
            ok: false as const,
            error: "llm_down",
            message: "model unavailable",
          };
        },
      }),
    });
    assert.equal(first.ok, true);
    assert.equal(cardCalls, 1);
    assert.equal(getVoiceProfile(user.id)?.cardJson, '{"tone":"old"}');
    // The next hourly pass finds new posts again, but the failed attempt was
    // stamped, so the once-per-UTC-day generation budget is not spent twice.
    await runUserIngest({
      user,
      mode: "hourly",
      deps: hourlyDeps({
        replies: [{ id: "new-2", text: "another fresh post" }],
        onCard: () => {
          cardCalls += 1;
          return newCard();
        },
      }),
    });
    assert.equal(cardCalls, 1);
    assert.equal(getVoiceProfile(user.id)?.cardJson, '{"tone":"old"}');
  });

  it("a failed hourly rewrite keeps the old card and stays ready", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "99",
      emailVerified: false,
      username: "me",
    });
    seedUnlockedCard(user.id, staleIso());
    const result = await runUserIngest({
      user,
      mode: "hourly",
      deps: hourlyDeps({
        replies: [{ id: "new-1", text: "fresh post" }],
        onCard: () => ({
          ok: false as const,
          error: "llm_down",
          message: "model unavailable",
        }),
      }),
    });
    assert.equal(result.ok, true);
    const profile = getVoiceProfile(user.id);
    assert.equal(profile?.cardJson, '{"tone":"old"}');
    assert.equal(profile?.status, "ready");
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

describe("beginVoiceCorpus", () => {
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

  it("starts an initial pull on first X link", async () => {
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
            conversationCount: 12,
            unlocked: false,
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

  it("skips a repeat pull when a cursor already exists", async () => {
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
              id: "1",
              text: "hi",
              postedAt: "2026-08-17T00:00:00.000Z",
              conversationId: "c1",
              source: "api",
            },
          ],
          newestId: "1",
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
            conversationCount: 1,
            unlocked: false,
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

  it("repoints the corpus when OAuth links a different account than the typed handle", async () => {
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
            conversationCount: 5,
            unlocked: false,
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

  it("forces a fresh pull after an account change", async () => {
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
            conversationCount: 0,
            unlocked: false,
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

  it("resolves the most recently linked X account for the OAuth identity", async () => {
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

  it("re-linking an earlier X account resolves as the most recent login", async () => {
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

  it("hourly ingest after an OAuth repoint follows the linked account, not the stale typed handle", async () => {
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
          conversationCount: 5,
          unlocked: false,
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
        foldLocal: async () => {},
        resolveUser: async (handle) => {
          resolvedHandle = handle;
          return { ok: true, id: "B", username: "b", protected: false };
        },
        pullReplies: async () => ({
          ok: true,
          replies: [],
          newestId: "old-b",
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
    assert.equal(resolvedHandle, "b");
  });

  it("does nothing without a handle", async () => {
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
            conversationCount: 0,
            unlocked: false,
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
