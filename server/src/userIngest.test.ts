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
import { upsertOauthUser } from "./authStore.ts";
import { getVoiceProfile } from "./voiceStore.ts";
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
});
