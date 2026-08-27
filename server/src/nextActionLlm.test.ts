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
import type { CoachingSnapshot } from "./coachingSnapshot.ts";
import {
  NEXT_ACTION_PROMPT_REV,
  NEXT_ACTION_SYSTEM,
  fallbackNextAction,
  getOrRefreshNextAction,
  nextActionCacheHash,
  parseNextActionJson,
} from "./nextActionLlm.ts";

const NOW_MS = Date.parse("2026-08-26T12:00:00.000Z");

function snapshot(
  partial: Partial<CoachingSnapshot> = {},
): CoachingSnapshot {
  return {
    dayUtc: "2026-08-26",
    marksToday: 0,
    originalsToday: 0,
    repliesPostedToday: 0,
    quotesToday: 0,
    deskPostsToday: 0,
    takeoffsToday: 0,
    suggestions: { total: 0, post: 0, quote: 0, repost: 0, reply: 0 },
    streak: 0,
    lastMarkUtcDay: null,
    level: 1,
    lifetimeXp: 0,
    ...partial,
  };
}

describe("nextActionLlm", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-next-action-"));
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

  it("grounds reply counts on marksToday and the mark_2 target", () => {
    assert.equal(nextActionCacheHash("abc"), `${NEXT_ACTION_PROMPT_REV}:abc`);
    assert.match(NEXT_ACTION_SYSTEM, /replyTarget/);
    assert.match(NEXT_ACTION_SYSTEM, /Never say hit 5 replies/);
    assert.doesNotMatch(NEXT_ACTION_SYSTEM, /hit 5 replies today/);
  });

  it("parses a grounded next-action payload", () => {
    const parsed = parseNextActionJson(
      '{"kind":"original","text":"You marked 3 replies and 0 originals — post one original."}',
    );
    assert.equal(parsed?.kind, "original");
    assert.match(parsed?.text ?? "", /0 originals/);
  });

  it("rejects unknown kinds and empty text", () => {
    assert.equal(parseNextActionJson('{"kind":"dance","text":"go"}'), null);
    assert.equal(parseNextActionJson('{"kind":"reply","text":""}'), null);
  });

  it("falls back to streak, then first reply, then original", () => {
    assert.equal(
      fallbackNextAction(
        snapshot({ streak: 4, lastMarkUtcDay: "2026-08-25" }),
      ).kind,
      "streak",
    );
    assert.equal(fallbackNextAction(snapshot()).kind, "reply");
    assert.equal(
      fallbackNextAction(
        snapshot({ marksToday: 2, originalsToday: 0, takeoffsToday: 1 }),
      ).kind,
      "original",
    );
  });

  it("reuses cache when the snapshot hash is unchanged", async () => {
    let calls = 0;
    const snap = snapshot({ marksToday: 1 });
    const first = await getOrRefreshNextAction({
      userId: "u1",
      snapshot: snap,
      inputsHash: "abc",
      nowMs: NOW_MS,
      chat: async () => {
        calls += 1;
        return {
          ok: true as const,
          content:
            '{"kind":"reply","text":"Mark one more reply — you are at 1."}',
          model: "test-model",
          provider: "deepseek" as const,
        };
      },
    });
    const second = await getOrRefreshNextAction({
      userId: "u1",
      snapshot: snap,
      inputsHash: "abc",
      nowMs: NOW_MS,
      chat: async () => {
        calls += 1;
        return {
          ok: true as const,
          content: '{"kind":"takeoff","text":"should not run"}',
          model: "test-model",
          provider: "deepseek" as const,
        };
      },
    });
    assert.equal(calls, 1);
    assert.equal(first.text, second.text);
    assert.equal(first.kind, "reply");
  });

  it("calls DeepSeek again when the hash changes", async () => {
    let calls = 0;
    await getOrRefreshNextAction({
      userId: "u1",
      snapshot: snapshot(),
      inputsHash: "one",
      nowMs: NOW_MS,
      chat: async () => {
        calls += 1;
        return {
          ok: true as const,
          content: '{"kind":"takeoff","text":"Take off once today."}',
          model: "test-model",
          provider: "deepseek" as const,
        };
      },
    });
    const next = await getOrRefreshNextAction({
      userId: "u1",
      snapshot: snapshot({ marksToday: 2 }),
      inputsHash: "two",
      nowMs: NOW_MS,
      chat: async () => {
        calls += 1;
        return {
          ok: true as const,
          content:
            '{"kind":"original","text":"You marked 2 replies and 0 originals — post one."}',
          model: "test-model",
          provider: "deepseek" as const,
        };
      },
    });
    assert.equal(calls, 2);
    assert.equal(next.kind, "original");
  });

  it("refreshes instead of serving a stale rev-1 cache row", async () => {
    getPlatformDb()
      .prepare(
        `INSERT INTO next_action_cache
           (user_id, kind, text, inputs_hash, model, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "u1",
        "reply",
        "stale hit-5-replies-era copy",
        "abc",
        "old-model",
        "2026-08-25T00:00:00.000Z",
      );
    let calls = 0;
    const action = await getOrRefreshNextAction({
      userId: "u1",
      snapshot: snapshot(),
      inputsHash: "abc",
      nowMs: NOW_MS,
      chat: async () => {
        calls += 1;
        return {
          ok: true as const,
          content: '{"kind":"takeoff","text":"Take off once to refill Approach."}',
          model: "test-model",
          provider: "deepseek" as const,
        };
      },
    });
    assert.equal(calls, 1);
    assert.equal(action.kind, "takeoff");
    assert.equal(action.text, "Take off once to refill Approach.");
  });
});
