import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expectRecord, testRequest } from "../http/http.testHelpers.js";
import { isRecord } from "../platform/unknownValue.js";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "../db.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { SESSION_COOKIE } from "../auth/sessionCookie.ts";
import { createSession } from "../auth/sessionStore.ts";
import { tryHandleInteracted } from "./interactedHttp.ts";
import {
  countTransitionsAtOrBefore,
  cooldownTransitionTimes,
  resetInteractedVersionForTests,
} from "./interactedVersion.ts";
import {
  MAX_INTERACTION_STORE,
  listInteractionHistory,
  markInteracted,
  readInteractionVersion,
} from "./interactionStore.ts";
import { patchInteractionStats } from "./interactionStats.ts";
import { setMemorySyncFailed } from "./interactionSync.ts";
import { COOLDOWN_MS } from "./interactionCooldown.ts";
import { resetInteractionMemoryReceiptForTests } from "../memory/interactionMemoryReceipt.ts";
import { writeInteractionMemory } from "../memory/knowledgeMemory.ts";

type Reply = { status: number; etag: string; json: Record<string, unknown> };

async function get(path: string, cookie: string, ifNoneMatch?: string): Promise<Reply> {
  const req = testRequest();
  Object.assign(req, {
    method: "GET",
    headers: { cookie, ...(ifNoneMatch ? { "if-none-match": ifNoneMatch } : {}) },
    socket: { remoteAddress: "127.0.0.1" },
  });
  let status = 0;
  let raw = "";
  let headers: Record<string, string> = {};
  const res = Object.assign(new ServerResponse(testRequest()), {
    writeHead: (code: number, written?: Record<string, string>) => {
      status = code;
      headers = written ?? {};
    },
    end: (chunk?: string) => {
      raw = chunk ?? "";
    },
  });
  const handled = await tryHandleInteracted(req, res, new URL(`http://localhost${path}`));
  assert.equal(handled, true);
  return { status, etag: headers.ETag ?? "", json: raw ? expectRecord(JSON.parse(raw)) : {} };
}

function rows(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value));
  return value.map((row: unknown) => {
    assert.ok(isRecord(row));
    return row;
  });
}

await describe("GET /api/interacted cheap ETag", async () => {
  let dir: string;
  let cwd: string;
  let knowledgeRoot: string;
  let userId: string;
  let cookie: string;

  async function expectChanged(previous: string, path = "/api/interacted"): Promise<Reply> {
    const next = await get(path, cookie, previous);
    assert.equal(next.status, 200);
    assert.notEqual(next.etag, previous);
    const again = await get(path, cookie, next.etag);
    assert.equal(again.status, 304);
    assert.equal(again.etag, next.etag);
    return next;
  }

  beforeEach(() => {
    resetPlatformDbForTests();
    resetInteractedVersionForTests();
    dir = mkdtempSync(join(tmpdir(), "x-interacted-etag-"));
    cwd = process.cwd();
    knowledgeRoot = join(dir, "knowledge");
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    resetInteractionMemoryReceiptForTests({ knowledgeRoot });
    process.chdir(dir);
    getPlatformDb();
    const user = upsertOauthUser({
      provider: "google", providerUserId: "etag-cheap", email: "cheap@example.com", emailVerified: true,
    });
    userId = user.id;
    cookie = `${SESSION_COOKIE}=${encodeURIComponent(createSession(user.id).token)}`;
  });

  afterEach(() => {
    mock.timers.reset();
    resetInteractionMemoryReceiptForTests();
    resetInteractedVersionForTests();
    resetPlatformDbForTests();
    process.chdir(cwd);
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  await it("answers a matching poll with 304 without reading history or serializing a body", async () => {
    await markInteracted({ threadId: "t1", author: "@a", userId, replyId: "901" });
    const first = await get("/api/interacted?includeRetained=1", cookie);
    assert.equal(first.status, 200);
    const prepare = mock.method(getPlatformDb(), "prepare");
    const stringify = mock.method(JSON, "stringify");
    try {
      const poll = await get("/api/interacted?includeRetained=1", cookie, first.etag);
      assert.equal(poll.status, 304);
      assert.equal(poll.etag, first.etag);
      const statements = prepare.mock.calls.map((call) => String(call.arguments[0]));
      assert.equal(statements.some((sql) => /SELECT \*\s+FROM desk_interactions/.test(sql)), false);
      assert.equal(
        stringify.mock.calls.some((call) => isRecord(call.arguments[0]) && "activeIds" in call.arguments[0]),
        false,
      );
    } finally {
      prepare.mock.restore();
      stringify.mock.restore();
    }
  });

  await it("changes on a mark, a re-mark, and a sync flag write", async () => {
    await markInteracted({ threadId: "t1", author: "@a", userId });
    const first = await get("/api/interacted", cookie);
    const marked = await markInteracted({ threadId: "t2", author: "@b", userId });
    const second = await expectChanged(first.etag);
    assert.deepEqual(rows(second.json.interactions).map((row) => row.threadId), ["t2", "t1"]);
    await markInteracted({ threadId: "t1", author: "@a", userId, nowMs: Date.parse(marked.at) + 1 });
    const third = await expectChanged(second.etag);
    await setMemorySyncFailed({ threadId: "t1", userId, failed: true });
    const fourth = await expectChanged(third.etag);
    assert.equal(rows(fourth.json.interactions)[0]?.memorySyncFailed, true);
  });

  await it("changes when a t24h stats sample lands on an existing row", async () => {
    await markInteracted({ threadId: "t1", author: "@a", userId, replyId: "901" });
    const first = await get("/api/interacted?includeRetained=1", cookie);
    await patchInteractionStats({
      threadId: "t1",
      userId,
      checkpoint: "t24h",
      snapshot: { views: 42, likes: 3, sampledAt: new Date().toISOString() },
    });
    const next = await expectChanged(first.etag, "/api/interacted?includeRetained=1");
    assert.deepEqual(rows(next.json.retainedInteractions)[0]?.stats, { t24h: { views: 42, likes: 3 } });
  });

  await it("changes when the memory receipt for a listed row changes without a row write", async () => {
    await writeInteractionMemory({ threadId: "2085", author: "@b", reply: "Other", userId, knowledgeRoot });
    const row = await markInteracted({ threadId: "2084", author: "@a", userId, replyId: "901" });
    const first = await get("/api/interacted", cookie);
    assert.deepEqual(rows(first.json.interactions)[0]?.memory, { state: "no_reply_text" });
    const versionBefore = readInteractionVersion(userId);
    await writeInteractionMemory({
      threadId: "2084",
      author: "@a",
      reply: "Saved reply text",
      userId,
      replyId: "901",
      interactedAt: row.postedAt ?? row.at,
      knowledgeRoot,
    });
    assert.equal(readInteractionVersion(userId), versionBefore);
    const next = await expectChanged(first.etag);
    assert.deepEqual(rows(next.json.interactions)[0]?.memory, { state: "saved" });
  });

  await it("changes when the retain trim drops the oldest row", async () => {
    const db = getPlatformDb();
    const insert = db.prepare(
      `INSERT INTO desk_interactions (user_id, tenant_id, thread_id, author, author_key, at, source)
       VALUES (?, 'local', ?, '@old', 'old', ?, 'manual')`,
    );
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    db.transaction(() => {
      for (let i = 0; i < MAX_INTERACTION_STORE; i++) {
        insert.run(userId, `old-${String(i).padStart(4, "0")}`, new Date(base + i * 1000).toISOString());
      }
    })();
    const first = await get("/api/interacted?includeRetained=1", cookie);
    assert.equal(first.json.total, MAX_INTERACTION_STORE);
    const versionBefore = readInteractionVersion(userId);
    await markInteracted({ threadId: "newest", author: "@n", userId });
    assert.equal(readInteractionVersion(userId), versionBefore + 2);
    const next = await expectChanged(first.etag, "/api/interacted?includeRetained=1");
    assert.equal(next.json.total, MAX_INTERACTION_STORE);
    const retained = rows(next.json.retainedInteractions).map((row) => row.threadId);
    assert.equal(retained.includes("old-0000"), false);
    assert.equal(retained[0], "newest");
    assert.equal((await listInteractionHistory({ userId, limit: MAX_INTERACTION_STORE + 5 })).length, MAX_INTERACTION_STORE);
  });

  await it("changes when a row ages out of the 24h activeIds window with no write", async () => {
    const now = Date.parse("2026-09-28T12:00:00.000Z");
    mock.timers.enable({ apis: ["Date"], now });
    await markInteracted({ threadId: "aging", author: "@a", userId, nowMs: now - COOLDOWN_MS + 1000 });
    await markInteracted({ threadId: "fresh", author: "@b", userId, nowMs: now - 5000 });
    const first = await get("/api/interacted", cookie);
    assert.deepEqual(first.json.activeIds, ["fresh", "aging"]);
    mock.timers.setTime(now + 999);
    assert.equal((await get("/api/interacted", cookie, first.etag)).status, 304);
    mock.timers.setTime(now + 1000);
    const expired = await expectChanged(first.etag);
    assert.deepEqual(expired.json.activeIds, ["fresh"]);
    mock.timers.setTime(now + COOLDOWN_MS - 5000);
    const empty = await expectChanged(expired.etag);
    assert.deepEqual(empty.json.activeIds, []);
  });

  await it("differs by page and by includeRetained", async () => {
    for (let i = 0; i < 12; i++) {
      await markInteracted({ threadId: `p${i}`, author: "@a", userId, nowMs: Date.now() - i * 1000 });
    }
    const first = await get("/api/interacted", cookie);
    const paged = await expectChanged(first.etag, "/api/interacted?page=2");
    assert.deepEqual(rows(paged.json.interactions).map((row) => row.threadId), ["p10", "p11"]);
    const retained = await expectChanged(first.etag, "/api/interacted?includeRetained=1");
    assert.equal(rows(retained.json.retainedInteractions).length, 12);
    assert.equal((await get("/api/interacted", cookie, retained.etag)).status, 200);
    assert.equal((await get("/api/interacted?page=1", cookie, first.etag)).status, 304);
  });

  await it("does not reuse an ETag across users or across a process restart", async () => {
    await markInteracted({ threadId: "t1", author: "@a", userId });
    const first = await get("/api/interacted", cookie);
    const other = upsertOauthUser({
      provider: "google", providerUserId: "etag-other", email: "other@example.com", emailVerified: true,
    });
    await markInteracted({ threadId: "t1", author: "@a", userId: other.id });
    const otherCookie = `${SESSION_COOKIE}=${encodeURIComponent(createSession(other.id).token)}`;
    assert.equal((await get("/api/interacted", otherCookie, first.etag)).status, 200);

    resetPlatformDbForTests();
    getPlatformDb();
    assert.equal((await get("/api/interacted", cookie, first.etag)).status, 304);
    resetInteractedVersionForTests();
    const restarted = await expectChanged(first.etag);
    assert.deepEqual(rows(restarted.json.interactions).map((row) => row.threadId), ["t1"]);
  });

  await it("counts activeIds window transitions at their exact boundaries", () => {
    const at = "2026-09-28T00:00:00.000Z";
    const times = cooldownTransitionTimes([at, "not a date"]);
    const start = Date.parse(at);
    assert.deepEqual(times, [start, start + COOLDOWN_MS]);
    assert.equal(countTransitionsAtOrBefore(times, start - 1), 0);
    assert.equal(countTransitionsAtOrBefore(times, start), 1);
    assert.equal(countTransitionsAtOrBefore(times, start + COOLDOWN_MS - 1), 1);
    assert.equal(countTransitionsAtOrBefore(times, start + COOLDOWN_MS), 2);
  });
});
