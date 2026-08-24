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
import type { ParsedPostCreate } from "./xActivity.ts";
import { upsertOwnPost } from "./ownPostStore.ts";
import {
  hasInsightToday,
  latestAnalyticsInsight,
  parseInsightJson,
  runAnalyticsInsightForUser,
  runAnalyticsInsights,
  saveAnalyticsInsight,
} from "./analyticsInsight.ts";

const NOW_MS = Date.parse("2026-08-24T12:00:00.000Z");

function post(partial: Partial<ParsedPostCreate> & { postId: string }): ParsedPostCreate {
  return {
    eventUuid: partial.eventUuid ?? `evt-${partial.postId}`,
    xUserId: partial.xUserId ?? "99",
    postId: partial.postId,
    kind: partial.kind ?? "original",
    text: partial.text ?? "hello",
    postedAt: partial.postedAt ?? "2026-08-20T12:00:00.000Z",
    inReplyToId: partial.inReplyToId ?? null,
    inReplyToUserId: partial.inReplyToUserId ?? null,
    conversationId: partial.conversationId ?? null,
    authorUsername: partial.authorUsername ?? "desk",
    metrics: partial.metrics ?? { views: 120, likes: 9, replies: 2 },
  };
}

const okChat = (content: string) => async () => ({
  ok: true as const,
  content,
  model: "test-model",
  provider: "deepseek" as const,
});

describe("analyticsInsight", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-insight-"));
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

  it("writes one grounded note per UTC day and returns it as the latest", async () => {
    upsertOwnPost({ parsed: post({ postId: "1" }), userId: "u1", tenantId: "t1" });
    const result = await runAnalyticsInsightForUser({
      userId: "u1",
      nowMs: NOW_MS,
      chat: okChat(
        '{"headline":"Your 1 post pulled 120 views.","bullets":["120 views on one original.","9 likes so far."]}',
      ),
    });
    assert.equal(result.wrote, true);
    assert.equal(result.reason, "ok");
    assert.equal(hasInsightToday("u1", NOW_MS), true);
    const insight = latestAnalyticsInsight("u1");
    assert.equal(insight?.headline, "Your 1 post pulled 120 views.");
    assert.equal(insight?.bullets.length, 2);
    assert.equal(insight?.day, "2026-08-24");
  });

  it("skips when it already wrote today — one LLM call per UTC day", async () => {
    upsertOwnPost({ parsed: post({ postId: "1" }), userId: "u1", tenantId: "t1" });
    saveAnalyticsInsight({
      userId: "u1",
      headline: "Existing.",
      bullets: ["a", "b"],
      model: "m",
      nowMs: NOW_MS,
    });
    let chatCalls = 0;
    const result = await runAnalyticsInsightForUser({
      userId: "u1",
      nowMs: NOW_MS,
      chat: async () => {
        chatCalls += 1;
        return okChat('{"headline":"x","bullets":["a","b"]}')();
      },
    });
    assert.equal(result.wrote, false);
    assert.equal(result.reason, "already_ran");
    assert.equal(chatCalls, 0);
    // A new UTC day runs again.
    const nextDay = NOW_MS + 24 * 60 * 60 * 1000;
    const again = await runAnalyticsInsightForUser({
      userId: "u1",
      nowMs: nextDay,
      chat: okChat('{"headline":"Fresh note.","bullets":["a","b"]}'),
    });
    assert.equal(again.wrote, true);
    assert.equal(latestAnalyticsInsight("u1")?.headline, "Fresh note.");
  });

  it("skips a user with no watched posts without calling the LLM", async () => {
    let chatCalls = 0;
    const result = await runAnalyticsInsightForUser({
      userId: "u-empty",
      nowMs: NOW_MS,
      chat: async () => {
        chatCalls += 1;
        return okChat('{"headline":"x","bullets":["a","b"]}')();
      },
    });
    assert.equal(result.wrote, false);
    assert.equal(result.reason, "thin");
    assert.equal(chatCalls, 0);
    assert.equal(latestAnalyticsInsight("u-empty"), null);
  });

  it("writes nothing when the model returns an unusable note", async () => {
    upsertOwnPost({ parsed: post({ postId: "1" }), userId: "u1", tenantId: "t1" });
    const result = await runAnalyticsInsightForUser({
      userId: "u1",
      nowMs: NOW_MS,
      chat: okChat('{"headline":"only one bullet","bullets":["a"]}'),
    });
    assert.equal(result.wrote, false);
    assert.equal(result.reason, "parse_error");
    assert.equal(latestAnalyticsInsight("u1"), null);
  });

  it("runAnalyticsInsights sweeps every own-post user and soft-fails per user", async () => {
    upsertOwnPost({ parsed: post({ postId: "1" }), userId: "u1", tenantId: "t1" });
    upsertOwnPost({ parsed: post({ postId: "2" }), userId: "u2", tenantId: "t2" });
    saveAnalyticsInsight({
      userId: "u2",
      headline: "Already there.",
      bullets: ["a", "b"],
      model: "m",
      nowMs: NOW_MS,
    });
    const result = await runAnalyticsInsights({
      nowMs: NOW_MS,
      chat: okChat('{"headline":"New note.","bullets":["a","b"]}'),
    });
    assert.equal(result.wrote, 1);
    assert.equal(result.skipped, 1);
    assert.equal(latestAnalyticsInsight("u1")?.headline, "New note.");
    assert.equal(latestAnalyticsInsight("u2")?.headline, "Already there.");
  });

  it("parseInsightJson enforces the headline + 2..4 bullets contract", () => {
    assert.equal(parseInsightJson("not json"), null);
    assert.equal(parseInsightJson('{"headline":"","bullets":["a","b"]}'), null);
    assert.equal(parseInsightJson('{"headline":"h","bullets":["a"]}'), null);
    const capped = parseInsightJson(
      '{"headline":"h","bullets":["a","b","c","d","e","f"]}',
    );
    assert.equal(capped?.bullets.length, 4);
    const fenced = parseInsightJson(
      '```json\n{"headline":"h","bullets":[" a ","b"]}\n```',
    );
    assert.deepEqual(fenced?.bullets, ["a", "b"]);
  });
});
