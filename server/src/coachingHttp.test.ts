import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { tryHandleCoaching } from "./coachingHttp.ts";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { upsertOauthUser } from "./oauthAccountStore.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";
import { createSession } from "./sessionStore.ts";
import type { ChatFn } from "./voiceLlm.ts";

async function getCoaching(opts: {
  path?: string;
  cookie?: string;
  chat?: ChatFn;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(req, {
    method: "GET",
    headers: opts.cookie ? { cookie: opts.cookie } : {},
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
  const path = opts.path ?? "/api/coaching";
  assert.equal(
    await tryHandleCoaching(req, res, new URL(`http://localhost${path}`), {
      chat: opts.chat,
    }),
    true,
  );
  return {
    status,
    body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
  };
}

describe("GET /api/coaching", () => {
  let dir: string;
  let cwd: string;
  let cookie: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-coaching-http-"));
    cwd = process.cwd();
    process.chdir(dir);
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    getPlatformDb();
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-coaching",
      email: "coaching@example.com",
      emailVerified: true,
    });
    const { token } = createSession(user.id);
    cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
  });

  afterEach(() => {
    resetPlatformDbForTests();
    process.chdir(cwd);
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns 401 without a session", async () => {
    const response = await getCoaching({});
    assert.equal(response.status, 401);
    assert.equal(response.body.error, "unauthenticated");
  });

  it("serves lite instruments without calling the LLM", async () => {
    const response = await getCoaching({
      path: "/api/coaching?lite=1",
      cookie,
      chat: async () => {
        throw new Error("lite coaching must not call chat");
      },
    });
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.dayUtc, "string");
    assert.equal(typeof response.body.postsToday, "number");
    assert.equal(typeof response.body.originalsToday, "number");
    assert.ok(response.body.beats);
    assert.deepEqual(response.body.replyAt, []);
    assert.deepEqual(response.body.postAt, []);
    assert.equal("nextAction" in response.body, false);
    assert.equal("missions" in response.body, false);
    assert.equal("originalAt" in response.body, false);
  });

  it("keeps the full coaching response and next-action refresh", async () => {
    let calls = 0;
    const response = await getCoaching({
      cookie,
      chat: async () => {
        calls += 1;
        return {
          ok: true as const,
          content: '{"kind":"reply","text":"Reply to one useful thread."}',
          model: "test-model",
          provider: "deepseek" as const,
        };
      },
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    assert.ok(response.body.nextAction);
    assert.ok(Array.isArray(response.body.missions));
    assert.ok(Array.isArray(response.body.originalAt));
  });
});
