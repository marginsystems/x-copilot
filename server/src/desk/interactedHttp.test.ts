import { isRecord } from "../platform/unknownValue.js";
import { testRequest } from "../http/http.testHelpers.js";
import { expectRecord } from "../http/http.testHelpers.js";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "../db.ts";
import { listInteractionHistory, markInteracted } from "./interactionStore.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { SESSION_COOKIE } from "../auth/sessionCookie.ts";
import { createSession } from "../auth/sessionStore.ts";
import { tryHandleInteracted } from "./interactedHttp.ts";
import { resetInteractionMemoryProjectionForTests } from "../memory/interactionMemoryProjection.ts";
import { resetInteractionMemoryReceiptForTests } from "../memory/interactionMemoryReceipt.ts";
import { writeInteractionMemory } from "../memory/knowledgeMemory.ts";

async function call(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<{ handled: boolean; status: number; json: Record<string, unknown> }> {
  const req = testRequest();
  Object.assign(req, {
    method,
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress: "127.0.0.1" },
  });
  let status = 0;
  let raw = "";
  const res = Object.assign(new ServerResponse(testRequest()), {
    writeHead: (code: number) => {
      status = code;
    },
    end: (chunk: string) => {
      raw = chunk;
    },
  });
  const handledPromise = tryHandleInteracted(
    req,
    res,
    new URL(`http://localhost${path}`),
  );
  if (body !== undefined) {
    (req).emit("data", Buffer.from(JSON.stringify(body)));
  }
  (req).emit("end");
  const handled = await handledPromise;
  return {
    handled,
    status,
    json: raw ? (expectRecord(JSON.parse(raw))) : {},
  };
}

await describe("interactedHttp", async () => {
  let dir: string;
  let cwd: string;

  beforeEach(() => {
    resetInteractionMemoryProjectionForTests();
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-interacted-http-"));
    cwd = process.cwd();
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    resetInteractionMemoryReceiptForTests({
      knowledgeRoot: join(dir, "knowledge"),
    });
    process.chdir(dir);
    getPlatformDb();
  });

  afterEach(() => {
    resetInteractionMemoryProjectionForTests();
    resetInteractionMemoryReceiptForTests();
    resetPlatformDbForTests();
    process.chdir(cwd);
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  await it("GET /api/interacted returns only the session user's marks", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-interacted-a",
      email: "a@example.com",
      emailVerified: true,
    });
    const other = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-interacted-b",
      email: "b@example.com",
      emailVerified: true,
    });
    await markInteracted({
      threadId: "thread-a",
      author: "@a",
      userId: user.id,
    });
    await markInteracted({
      threadId: "thread-b",
      author: "@b",
      userId: other.id,
    });
    const { token } = createSession(user.id);
    const { handled, status, json } = await call(
      "GET",
      "/api/interacted",
      undefined,
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.deepEqual(
      (parseDatabaseRow(json.interactions)).map(
        (row) => row.threadId,
      ),
      ["thread-a"],
    );
    assert.deepEqual(json.activeIds, ["thread-a"]);
  });

  await it("pages stored history while preserving retained cooldown and blocked ids", async () => {
    const user = upsertOauthUser({
      provider: "google", providerUserId: "pages", email: "pages@example.com", emailVerified: true,
    });
    const now = Date.now();
    for (let i = 0; i < 215; i++) {
      await markInteracted({
        threadId: `page-${i}`, author: "@pages", userId: user.id,
        nowMs: i === 0 ? now - 2 * 86400000 : now - 215 + i,
        conversationId: `root-${i}`, inReplyToId: `parent-${i}`,
      });
    }
    const { token } = createSession(user.id);
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
    for (const query of ["", "?page=1", "?page=0", "?page=-1", "?page=1.5", "?page=no", "?page=Infinity", "?page=9007199254740992"]) {
      const { json } = await call("GET", `/api/interacted${query}`, undefined, cookie);
      assert.equal(json.total, 215);
      assert.equal(json.page, 1);
      assert.equal(json.pageSize, 10);
      assert.deepEqual(parseDatabaseRow(json.interactions).map((row) => row.threadId),
        Array.from({ length: 10 }, (_, i) => `page-${214 - i}`));
      assert.ok(Array.isArray(json.activeIds));
      assert.equal(json.activeIds.length, 214);
      assert.ok(json.activeIds.includes("page-1"));
      assert.ok(!json.activeIds.includes("page-0"));
      assert.ok(Array.isArray(json.blockedIds));
      assert.equal(json.blockedIds.length, 645);
      for (const id of ["page-0", "root-0", "parent-0"]) assert.ok(json.blockedIds.includes(id));
    }
    const { json: last } = await call("GET", "/api/interacted?page=22", undefined, cookie);
    assert.equal(last.page, 22);
    assert.equal(last.total, 215);
    assert.deepEqual(parseDatabaseRow(last.interactions).map((row) => row.threadId),
      ["page-4", "page-3", "page-2", "page-1", "page-0"]);
    const { json: past } = await call("GET", "/api/interacted?page=23", undefined, cookie);
    assert.equal(past.page, 23);
    assert.equal(past.total, 215);
    assert.deepEqual(past.interactions, []);
  });

  await it("GET /api/interacted returns empty data without a session", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-interacted-sole",
      email: "sole@example.com",
      emailVerified: true,
    });
    await markInteracted({
      threadId: "owned",
      author: "@owner",
      userId: user.id,
    });
    const { status, json } = await call("GET", "/api/interacted");
    assert.equal(status, 200);
    assert.deepEqual(json.interactions, []);
    assert.deepEqual(json.activeIds, []);
    assert.deepEqual(json.blockedIds, []);
    assert.equal(json.total, 0);
    assert.equal(json.page, 1);
    assert.equal(json.pageSize, 10);
  });

  await it("a mark without a userId is refused at the store", async () => {
    await assert.rejects(
      async () => {
        const result: unknown = Reflect.apply(markInteracted, undefined, [{ threadId: "unowned", author: "@legacy" }]);
        assert.ok(result instanceof Promise);
        await result;
      },
      /userId is required/,
    );
  });

  await it("GET /api/interacted/stats returns empty stats without a session", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-interacted-stats",
      email: "stats@example.com",
      emailVerified: true,
    });
    await markInteracted({
      threadId: "hidden",
      author: "@hidden",
      userId: user.id,
    });
    const { status, json } = await call("GET", "/api/interacted/stats");
    assert.equal(status, 200);
    assert.deepEqual(json.totals, {
      interactions: 0,
      originals: 0,
      quotes: 0,
      replies: 0,
      views: 0,
      withStats: 0,
    });
  });

  await it("POST /api/interacted/detect rejects a missing threadId", async () => {
    const { handled, status, json } = await call(
      "POST",
      "/api/interacted/detect",
      {},
    );
    assert.equal(handled, true);
    assert.equal(status, 400);
    assert.equal(json.error, "bad_request");
  });

  await it("POST /api/interacted/detect is 503 when X username is unresolved", async () => {
    const { handled, status, json } = await call(
      "POST",
      "/api/interacted/detect",
      { threadId: "123" },
    );
    assert.equal(handled, true);
    assert.equal(status, 503);
    assert.equal(json.error, "identity_unresolved");
  });

  await it("POST /api/interacted/detect resolves the session user's ledger first", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-detect-a",
      email: "detect-a@example.com",
      emailVerified: true,
    });
    const other = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-detect-b",
      email: "detect-b@example.com",
      emailVerified: true,
    });
    await markInteracted({
      threadId: "target",
      author: "@other",
      userId: other.id,
      replyId: "other-reply",
      replyUrl: "https://x.com/other/status/other-reply",
    });
    await markInteracted({
      threadId: "card",
      conversationId: "target",
      author: "@mine",
      userId: user.id,
      replyId: "mine-reply",
      replyUrl: "https://x.com/mine/status/mine-reply",
    });
    const { token } = createSession(user.id);

    const { status, json } = await call(
      "POST",
      "/api/interacted/detect",
      { threadId: "target", once: true },
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );

    assert.equal(status, 200);
    assert.equal(json.found, true);
    const reply = expectRecord(json.reply);
    assert.equal(reply.replyId, "mine-reply");
    assert.equal(reply.replyUrl, "https://x.com/mine/status/mine-reply");
    assert.equal(reply.replyText, undefined);
  });

  await it("POST /api/interacted without a session is 401", async () => {
    const { handled, status, json } = await call("POST", "/api/interacted", {
      threadId: "123",
      author: "@x",
      reply: "https://x.com/me/status/1",
    });
    assert.equal(handled, true);
    assert.equal(status, 401);
    assert.equal(json.error, "unauthenticated");
  });

  await it("POST /api/interacted rejects a missing reply URL", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-interacted-post",
      email: "post@example.com",
      emailVerified: true,
    });
    const { token } = createSession(user.id);
    const { handled, status, json } = await call(
      "POST",
      "/api/interacted",
      { threadId: "123", author: "@x" },
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );
    assert.equal(handled, true);
    assert.equal(status, 400);
    assert.equal(json.error, "bad_request");
  });

  await it("POST /api/interacted without reply text stays 200 and awards XP", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-interacted-no-reply",
      email: "noreply@example.com",
      emailVerified: true,
    });
    const { token } = createSession(user.id);
    const { status, json } = await call(
      "POST",
      "/api/interacted",
      {
        threadId: "2081",
        author: "@x",
        replyUrl: "https://x.com/me/status/9001",
        text: "Parent post must not be stored as a reply.",
      },
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.memoryPath, undefined);
    assert.deepEqual(json.memory, { state: "no_reply_text" });
    const gamification = parseGamificationRow(json.gamification);
    assert.equal(gamification.lifetimeXp, 1);
    const history = await listInteractionHistory({ userId: user.id });
    assert.equal(history.length, 1);
    assert.equal(history[0]?.threadId, "2081");
    assert.equal(history[0]?.replyId, "9001");
  });

  await it("POST /api/interacted keeps the mark and XP on an ownership conflict", async () => {
    resetInteractionMemoryProjectionForTests({
      writeNote: async () => {
        throw new Error("interaction note belongs to another user");
      },
    });
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-interacted-mem-fail",
      email: "memfail@example.com",
      emailVerified: true,
    });
    const { token } = createSession(user.id);
    const { status, json } = await call(
      "POST",
      "/api/interacted",
      {
        threadId: "2082",
        author: "@x",
        replyUrl: "https://x.com/me/status/9002",
        reply: "Confirmed reply text",
      },
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.memoryPath, undefined);
    assert.deepEqual(json.memory, { state: "unavailable" });
    const gamification = parseGamificationRow(json.gamification);
    assert.equal(gamification.lifetimeXp, 1);
    const history = await listInteractionHistory({ userId: user.id });
    assert.equal(history.length, 1);
    assert.equal(history[0]?.threadId, "2082");
  });

  await it("POST /api/interacted keeps the mark when evidence capture fails", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-interacted-evidence-fail",
      email: "evidencefail@example.com",
      emailVerified: true,
    });
    const { token } = createSession(user.id);
    getPlatformDb().exec("DROP TABLE scout_target_context");

    const { status, json } = await call(
      "POST",
      "/api/interacted",
      {
        threadId: "2084",
        author: "@x",
        replyUrl: "https://x.com/me/status/9004",
        reply: "Confirmed reply text",
      },
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );

    assert.equal(status, 200);
    assert.equal(json.ok, true);
    const history = await listInteractionHistory({ userId: user.id });
    assert.equal(history.length, 1);
    assert.equal(history[0]?.threadId, "2084");
  });

  await it("POST /api/interacted returns memoryPath when the note is saved", async () => {
    const knowledgeRoot = join(dir, "knowledge");
    resetInteractionMemoryProjectionForTests({
      writeNote: (input) =>
        writeInteractionMemory({ ...input, knowledgeRoot }),
      scheduleUpsert: () => {},
    });
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-interacted-mem-ok",
      email: "memok@example.com",
      emailVerified: true,
    });
    const { token } = createSession(user.id);
    const { status, json } = await call(
      "POST",
      "/api/interacted",
      {
        threadId: "2083",
        author: "@x",
        replyUrl: "https://x.com/me/status/9003",
        reply: "Confirmed reply text",
        text: "Card context stays in Post, not Reply.",
      },
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal((parseDatabaseRow2(json.memory)).state, "saved");
    assert.equal(json.memoryPath, (parseDatabaseRow3(json.memory)).memoryPath);
    const body = await readFile(json.memoryPath as string, "utf8");
    assert.match(body, /Confirmed reply text/);
    assert.match(body, /Card context stays in Post/);
    const gamification = parseGamificationRow(json.gamification);
    assert.equal(gamification.lifetimeXp, 1);
  });

  await it("POST /api/interacted/detect does not write reply memory", async () => {
    let wrote = false;
    resetInteractionMemoryProjectionForTests({
      writeNote: async () => {
        wrote = true;
        return { path: "/tmp/should-not-write.md" };
      },
    });
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-detect-no-write",
      email: "detect-nowrite@example.com",
      emailVerified: true,
    });
    await markInteracted({
      threadId: "card",
      conversationId: "target",
      author: "@mine",
      userId: user.id,
      replyId: "mine-reply",
      replyUrl: "https://x.com/mine/status/mine-reply",
      text: "Stored parent text is not a confirmed reply.",
    });
    const { token } = createSession(user.id);
    const { status, json } = await call(
      "POST",
      "/api/interacted/detect",
      { threadId: "target", once: true },
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );
    assert.equal(status, 200);
    assert.equal(json.found, true);
    const reply = expectRecord(json.reply);
    assert.equal(reply.replyText, undefined);
    assert.equal(wrote, false);
  });

  await it("GET /api/interacted reports saved, no-note, and wrong-owner receipts", async () => {
    const knowledgeRoot = join(dir, "knowledge");
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-interacted-receipt",
      email: "receipt@example.com",
      emailVerified: true,
    });
    const other = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-interacted-receipt-other",
      email: "receipt-other@example.com",
      emailVerified: true,
    });
    const saved = await markInteracted({
      threadId: "2081",
      author: "@saved",
      userId: user.id,
    });
    await markInteracted({
      threadId: "2082",
      author: "@none",
      userId: user.id,
    });
    const stolen = await markInteracted({
      threadId: "2083",
      author: "@other",
      userId: user.id,
    });
    await writeInteractionMemory({
      threadId: "2081",
      author: "@saved",
      reply: "Owned confirmed reply.",
      userId: user.id,
      interactedAt: saved.at,
      knowledgeRoot,
    });
    await writeInteractionMemory({
      threadId: "2083",
      author: "@other",
      reply: "Written for another desk.",
      userId: other.id,
      interactedAt: stolen.at,
      knowledgeRoot,
    });
    const { token } = createSession(user.id);
    const { status, json } = await call(
      "GET",
      "/api/interacted",
      undefined,
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );
    assert.equal(status, 200);
    const rows = parseRowsRow(json.interactions);
    assert.deepEqual(
      Object.fromEntries(rows.map((row) => [row.threadId, row.memory?.state])),
      {
        "2081": "saved",
        "2082": "no_reply_text",
        "2083": "unavailable",
      },
    );
    for (const row of rows) {
      assert.equal("memoryPath" in (row.memory ?? {}), false);
      assert.equal(typeof row.threadId, "string");
      assert.equal(typeof row.author, "string");
      assert.equal(typeof row.at, "string");
    }
  });

  await it("GET /api/interacted still parses for callers that ignore memory", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-interacted-old-caller",
      email: "old@example.com",
      emailVerified: true,
    });
    await markInteracted({
      threadId: "legacy",
      author: "@legacy",
      userId: user.id,
    });
    const { token } = createSession(user.id);
    const { json } = await call(
      "GET",
      "/api/interacted",
      undefined,
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );
    const rows = (parseunknown(json.interactions)).filter((row) => {
      if (!row || typeof row !== "object") return false;
      const rec = parseRecRow(row);
      return (
        typeof rec.threadId === "string" &&
        typeof rec.author === "string" &&
        typeof rec.at === "string"
      );
    });
    assert.deepEqual(
      rows.map((row) => (parseDatabaseRow4(row)).threadId),
      ["legacy"],
    );
  });

  await it("ignores unrelated paths", async () => {
    const { handled, status } = await call("GET", "/api/skipped");
    assert.equal(handled, false);
    assert.equal(status, 0);
  });
});

function parseDatabaseRow(value: unknown): Array<{ threadId: string }> {
  const valid = (row: unknown): row is Array<{ threadId: string }> =>
    (Array.isArray(row) && row.every((item: unknown) => (isRecord(item) &&
    typeof item.threadId === "string")));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseGamificationRow(value: unknown): { lifetimeXp: number } {
  const valid = (row: unknown): row is { lifetimeXp: number } =>
    (isRecord(row) &&
    typeof row.lifetimeXp === "number");
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseDatabaseRow2(value: unknown): { state: string } {
  const valid = (row: unknown): row is { state: string } =>
    (isRecord(row) &&
    typeof row.state === "string");
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseDatabaseRow3(value: unknown): { memoryPath: string } {
  const valid = (row: unknown): row is { memoryPath: string } =>
    (isRecord(row) &&
    typeof row.memoryPath === "string");
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseRowsRow(value: unknown): Array<{
      threadId: string;
      author: string;
      at: string;
      memory?: { state?: string; memoryPath?: string };
    }> {
  const valid = (row: unknown): row is Array<{
      threadId: string;
      author: string;
      at: string;
      memory?: { state?: string; memoryPath?: string };
    }> =>
    (Array.isArray(row) && row.every((item: unknown) => (isRecord(item) &&
    typeof item.threadId === "string" &&
    typeof item.author === "string" &&
    typeof item.at === "string" &&
    (item.memory === undefined || (isRecord(item.memory) &&
    (item.memory.state === undefined || typeof item.memory.state === "string") &&
    (item.memory.memoryPath === undefined || typeof item.memory.memoryPath === "string"))))));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseunknown(value: unknown): unknown[] {
  const valid = (row: unknown): row is unknown[] =>
    (Array.isArray(row) && row.every((item: unknown) => true));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseRecRow(value: unknown): { threadId?: unknown; author?: unknown; at?: unknown } {
  const valid = (row: unknown): row is { threadId?: unknown; author?: unknown; at?: unknown } =>
    (isRecord(row) &&
    true &&
    true &&
    true);
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseDatabaseRow4(value: unknown): { threadId: string } {
  const valid = (row: unknown): row is { threadId: string } =>
    (isRecord(row) &&
    typeof row.threadId === "string");
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}
