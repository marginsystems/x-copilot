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
  countDistinctConversations,
  countVoiceReplies,
  ensureVoiceProfile,
  getVoiceProfile,
  resetUserVoiceCorpus,
  updateVoiceProfilePull,
  upsertVoiceReplies,
} from "./voiceStore.ts";

const USER = "user-voice-1";
const TENANT = "local";

function seedReplies(count: number, opts?: { conversation?: string }): void {
  upsertVoiceReplies(
    USER,
    Array.from({ length: count }, (_, i) => ({
      id: `10${String(i).padStart(4, "0")}`,
      text: `reply number ${i} with some substance`,
      conversationId: opts?.conversation ?? `20${String(i).padStart(4, "0")}`,
      postedAt: new Date(Date.UTC(2026, 6, 1, 12, 0, i)).toISOString(),
    })),
  );
}

await describe("voiceStore", async () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-voice-"));
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

  await it("counts posts separately from the conversations they share", () => {
    seedReplies(100, { conversation: "same-thread" });
    assert.equal(countVoiceReplies(USER), 100);
    assert.equal(countDistinctConversations(USER), 1);
  });

  await it("dedupes re-pulled replies so incremental never double-counts", () => {
    seedReplies(20);
    const added = upsertVoiceReplies(USER, [
      { id: "100001", text: "reply number 1 with some substance" },
      { id: "300000", text: "genuinely new reply" },
    ]);
    assert.equal(added, 1);
    assert.equal(countVoiceReplies(USER), 21);
  });

  await it("persists the pull cursor and counts on the profile", () => {
    ensureVoiceProfile(USER, TENANT);
    seedReplies(3);
    updateVoiceProfilePull({
      userId: USER,
      xUsername: "margin",
      xUserId: "42",
      sinceId: "100002",
      lastPullAt: "2026-08-15T09:00:00.000Z",
    });
    const profile = getVoiceProfile(USER);
    assert.equal(profile?.xUsername, "margin");
    assert.equal(profile?.xUserId, "42");
    assert.equal(profile?.sinceId, "100002");
    assert.equal(profile?.lastPullAt, "2026-08-15T09:00:00.000Z");
    assert.equal(profile?.replyCount, 3);
    assert.equal(profile?.conversationCount, 3);
    assert.equal(profile?.lastError, null);
  });

  await it("records a pull error and clears it on the next clean pull", () => {
    ensureVoiceProfile(USER, TENANT);
    updateVoiceProfilePull({
      userId: USER,
      xUsername: "margin",
      lastError: "X is down",
    });
    assert.equal(getVoiceProfile(USER)?.lastError, "X is down");
    updateVoiceProfilePull({ userId: USER, xUsername: "margin" });
    assert.equal(getVoiceProfile(USER)?.lastError, null);
  });

  await it("resets the corpus and pull cursor for a new account", () => {
    ensureVoiceProfile(USER, TENANT);
    seedReplies(3);
    updateVoiceProfilePull({
      userId: USER,
      xUsername: "margin",
      xUserId: "42",
      sinceId: "100002",
    });
    resetUserVoiceCorpus(USER, "42");
    const profile = getVoiceProfile(USER);
    assert.equal(countVoiceReplies(USER), 0);
    assert.equal(profile?.xUserId, null);
    assert.equal(profile?.sinceId, null);
    assert.equal(profile?.replyCount, 0);
  });
});
