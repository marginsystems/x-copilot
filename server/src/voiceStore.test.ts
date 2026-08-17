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
  VOICE_UNLOCK_MIN_POSTS,
  countDistinctConversations,
  countSuggestsToday,
  countVoiceReplies,
  ensureVoiceProfile,
  foldDeskReplies,
  foldMemoryReplies,
  getSuggestUsage,
  getVoiceProfile,
  listVoiceReplies,
  recordSuggest,
  removeSuggestRecord,
  reserveSuggestSlot,
  saveVoiceCard,
  suggestLimitForPlan,
  updateVoiceProfilePull,
  upsertVoiceReplies,
  voiceUnlocked,
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

describe("voiceStore", () => {
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

  it("unlocks at 100 posts even when they share a conversation", () => {
    assert.equal(VOICE_UNLOCK_MIN_POSTS, 100);
    seedReplies(100, { conversation: "same-thread" });
    assert.equal(countVoiceReplies(USER), 100);
    assert.equal(countDistinctConversations(USER), 1);
    assert.equal(voiceUnlocked(countVoiceReplies(USER)), true);
  });

  it("unlocks at exactly 100 posts", () => {
    seedReplies(99);
    assert.equal(voiceUnlocked(countVoiceReplies(USER)), false);
    upsertVoiceReplies(USER, [
      { id: "999999", text: "the hundredth", conversationId: "conv-100th" },
    ]);
    assert.equal(countVoiceReplies(USER), 100);
    assert.equal(voiceUnlocked(countVoiceReplies(USER)), true);
  });

  it("dedupes re-pulled replies so incremental never double-counts", () => {
    seedReplies(20);
    const added = upsertVoiceReplies(USER, [
      { id: "100001", text: "reply number 1 with some substance" },
      { id: "300000", text: "genuinely new reply" },
    ]);
    assert.equal(added, 1);
    assert.equal(countVoiceReplies(USER), 21);
  });

  it("caps free suggests at 10 per UTC day and resets next day", () => {
    assert.equal(suggestLimitForPlan("free"), 10);
    const day = new Date("2026-08-15T09:00:00.000Z");
    for (let i = 0; i < 10; i += 1) {
      recordSuggest(USER, `t${i}`, new Date(day.getTime() + i * 1000).toISOString());
    }
    const usage = getSuggestUsage(USER, "free", day);
    assert.equal(usage.used, 10);
    assert.equal(usage.remaining, 0);
    assert.equal(usage.canSuggest, false);

    // 00:00 UTC refill.
    const nextDay = new Date("2026-08-16T00:00:01.000Z");
    assert.equal(countSuggestsToday(USER, nextDay), 0);
    assert.equal(getSuggestUsage(USER, "free", nextDay).canSuggest, true);
  });

  it("reserves a suggest slot atomically up to the day's cap", () => {
    const day = new Date("2026-08-15T09:00:00.000Z");
    for (let i = 0; i < 10; i += 1) {
      const id = reserveSuggestSlot(
        USER,
        10,
        `t${i}`,
        new Date(day.getTime() + i * 1000),
      );
      assert.ok(id);
    }
    assert.equal(reserveSuggestSlot(USER, 10, "t-late", day), null);
    assert.equal(countSuggestsToday(USER, day), 10);
  });

  it("releases a reserved suggest slot when the generation fails", () => {
    const id = reserveSuggestSlot(USER, 10, "t1");
    assert.ok(id);
    removeSuggestRecord(id!);
    assert.ok(reserveSuggestSlot(USER, 10, "t2"));
    assert.equal(countSuggestsToday(USER), 1);
  });

  it("gives paid plans a conservative bump", () => {
    assert.equal(suggestLimitForPlan("pulse"), 20);
    assert.equal(suggestLimitForPlan("radar"), 30);
    assert.equal(suggestLimitForPlan("horizon"), 40);
  });

  it("persists the card and pull cursor on the profile", () => {
    ensureVoiceProfile(USER, TENANT);
    seedReplies(3);
    updateVoiceProfilePull({
      userId: USER,
      xUsername: "margin",
      xUserId: "42",
      sinceId: "100002",
    });
    saveVoiceCard({ userId: USER, cardJson: '{"tone":"dry"}', model: "deepseek-v4-flash" });
    const profile = getVoiceProfile(USER);
    assert.equal(profile?.status, "ready");
    assert.equal(profile?.sinceId, "100002");
    assert.equal(profile?.replyCount, 3);
    assert.equal(profile?.conversationCount, 3);
    assert.ok(profile?.cardUpdatedAt);
  });

  it("folds desk-detected replies from own_posts into the corpus", () => {
    getPlatformDb()
      .prepare(
        `INSERT INTO own_posts (id, user_id, tenant_id, x_user_id, kind, text, posted_at, conversation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "555001",
        USER,
        TENANT,
        "42",
        "reply",
        "posted from the desk after a suggest",
        "2026-08-14T10:00:00.000Z",
        "conv-desk",
        "2026-08-14T10:00:00.000Z",
      );
    assert.equal(foldDeskReplies(USER), 1);
    // Idempotent on the second fold.
    assert.equal(foldDeskReplies(USER), 0);
    const rows = listVoiceReplies(USER, 10);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.source, "desk");
  });

  it("folds interacted-memory replies into the corpus", () => {
    assert.equal(
      foldMemoryReplies(USER, [
        {
          id: "mem:1",
          text: "marked reply from a memory note",
          conversationId: "conv-mem",
        },
      ]),
      1,
    );
    assert.equal(
      foldMemoryReplies(USER, [
        {
          id: "mem:1",
          text: "marked reply from a memory note",
          conversationId: "conv-mem",
        },
      ]),
      0,
    );
    const rows = listVoiceReplies(USER, 10);
    assert.equal(rows[0]?.source, "memory");
    assert.equal(rows[0]?.conversationId, "conv-mem");
  });
});
