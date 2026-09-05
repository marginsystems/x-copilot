import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { markInteracted } from "./interactionStore.ts";
import { upsertOauthUser } from "./oauthAccountStore.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";
import { createSession } from "./sessionStore.ts";
import { tryHandleInteracted } from "./interactedHttp.ts";

async function call(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<{ handled: boolean; status: number; json: Record<string, unknown> }> {
  const req = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(req, {
    method,
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress: "127.0.0.1" },
  });
  let status = 0;
  let raw = "";
  const res = {
    writeHead: (code: number) => {
      status = code;
    },
    end: (chunk: string) => {
      raw = chunk;
    },
  } as unknown as ServerResponse;
  const handledPromise = tryHandleInteracted(
    req,
    res,
    new URL(`http://localhost${path}`),
  );
  if (body !== undefined) {
    (req as EventEmitter).emit("data", Buffer.from(JSON.stringify(body)));
  }
  (req as EventEmitter).emit("end");
  const handled = await handledPromise;
  return {
    handled,
    status,
    json: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
  };
}

describe("interactedHttp", () => {
  let dir: string;
  let cwd: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-interacted-http-"));
    cwd = process.cwd();
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    process.chdir(dir);
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    process.chdir(cwd);
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("GET /api/interacted returns only the session user's marks", async () => {
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
      (json.interactions as Array<{ threadId: string }>).map(
        (row) => row.threadId,
      ),
      ["thread-a"],
    );
    assert.deepEqual(json.activeIds, ["thread-a"]);
  });

  it("GET /api/interacted returns empty data without a session", async () => {
    await markInteracted({
      threadId: "unowned",
      author: "@legacy",
    });
    const { status, json } = await call("GET", "/api/interacted");
    assert.equal(status, 200);
    assert.deepEqual(json.interactions, []);
    assert.deepEqual(json.activeIds, []);
  });

  it("GET /api/interacted keeps legacy marks for the sole user", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-interacted-sole",
      email: "sole@example.com",
      emailVerified: true,
    });
    await markInteracted({
      threadId: "legacy-thread",
      author: "@legacy",
    });
    const { token } = createSession(user.id);
    const { status, json } = await call(
      "GET",
      "/api/interacted",
      undefined,
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );
    assert.equal(status, 200);
    assert.deepEqual(
      (json.interactions as Array<{ threadId: string }>).map(
        (row) => row.threadId,
      ),
      ["legacy-thread"],
    );
    assert.deepEqual(json.activeIds, ["legacy-thread"]);
  });

  it("GET /api/interacted/stats returns empty stats without a session", async () => {
    await markInteracted({
      threadId: "hidden",
      author: "@hidden",
    });
    const { status, json } = await call("GET", "/api/interacted/stats");
    assert.equal(status, 200);
    assert.deepEqual(json.totals, {
      interactions: 0,
      views: 0,
      withStats: 0,
    });
  });

  it("POST /api/interacted/detect rejects a missing threadId", async () => {
    const { handled, status, json } = await call(
      "POST",
      "/api/interacted/detect",
      {},
    );
    assert.equal(handled, true);
    assert.equal(status, 400);
    assert.equal(json.error, "bad_request");
  });

  it("POST /api/interacted/detect is 503 when X username is unresolved", async () => {
    const { handled, status, json } = await call(
      "POST",
      "/api/interacted/detect",
      { threadId: "123" },
    );
    assert.equal(handled, true);
    assert.equal(status, 503);
    assert.equal(json.error, "identity_unresolved");
  });

  it("POST /api/interacted/detect resolves the session user's ledger first", async () => {
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
    const reply = json.reply as Record<string, unknown>;
    assert.equal(reply.replyId, "mine-reply");
    assert.equal(reply.replyUrl, "https://x.com/mine/status/mine-reply");
    assert.equal(reply.replyText, "");
  });

  it("POST /api/interacted rejects a missing reply URL", async () => {
    const { handled, status, json } = await call("POST", "/api/interacted", {
      threadId: "123",
      author: "@x",
    });
    assert.equal(handled, true);
    assert.equal(status, 400);
    assert.equal(json.error, "bad_request");
  });

  it("ignores unrelated paths", async () => {
    const { handled, status } = await call("GET", "/api/skipped");
    assert.equal(handled, false);
    assert.equal(status, 0);
  });
});
