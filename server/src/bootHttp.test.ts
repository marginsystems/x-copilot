import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tryHandleBoot } from "./bootHttp.ts";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { markInteracted } from "./interactionStore.ts";
import { upsertOauthUser } from "./oauthAccountStore.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";
import { createSession } from "./sessionStore.ts";

async function get(
  path: string,
  cookie?: string,
): Promise<{ handled: boolean; status: number; body: Record<string, unknown> }> {
  let status = 0;
  let raw = "";
  const req = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(req, {
    method: "GET",
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress: "127.0.0.1" },
  });
  const res = {
    writeHead: (code: number) => {
      status = code;
    },
    end: (chunk: string) => {
      raw = chunk;
    },
  } as unknown as ServerResponse;
  const handled = await tryHandleBoot(
    req,
    res,
    new URL(`http://localhost${path}`),
  );
  return {
    handled,
    status,
    body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
  };
}

describe("GET /api/boot", () => {
  const prevAuth = process.env.AUTH_REQUIRED;
  let dir: string;
  let cwd: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-boot-http-"));
    cwd = process.cwd();
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    process.env.AUTH_REQUIRED = "1";
    process.chdir(dir);
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    process.chdir(cwd);
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    if (prevAuth === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = prevAuth;
    rmSync(dir, { recursive: true, force: true });
  });

  it("ignores unrelated paths", async () => {
    const { handled, status } = await get("/api/health");
    assert.equal(handled, false);
    assert.equal(status, 0);
  });

  it("returns 401 without a session when auth is required", async () => {
    const { handled, status, body } = await get("/api/boot");
    assert.equal(handled, true);
    assert.equal(status, 401);
    assert.equal(body.ok, false);
    assert.equal(body.authRequired, true);
  });

  it("returns auth + desk slices in one payload", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-boot",
      email: "boot@example.com",
      emailVerified: true,
    });
    const { token } = createSession(user.id);
    const { handled, status, body } = await get(
      "/api/boot?dedupeAccounts=true",
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.authRequired, true);
    const publicUser = body.user as { id?: string; email?: string };
    assert.equal(publicUser.id, user.id);
    assert.equal(publicUser.email, "boot@example.com");
    const desk = body.desk as Record<string, unknown>;
    assert.ok(desk);
    assert.ok(desk.interacted && typeof desk.interacted === "object");
    assert.ok(desk.dismissed && typeof desk.dismissed === "object");
    assert.ok(desk.skipped && typeof desk.skipped === "object");
    assert.ok(desk.expired && typeof desk.expired === "object");
    assert.ok(desk.forYou && typeof desk.forYou === "object");
    assert.ok(desk.lastScout && typeof desk.lastScout === "object");
    assert.ok(desk.scoutLog && typeof desk.scoutLog === "object");
    assert.ok(desk.gamification && typeof desk.gamification === "object");
    assert.ok(desk.activityStats && typeof desk.activityStats === "object");
    assert.ok(desk.coaching && typeof desk.coaching === "object");
    const lastScout = desk.lastScout as { ok?: boolean; empty?: boolean };
    assert.equal(lastScout.ok, true);
    assert.equal(lastScout.empty, true);
    const coaching = desk.coaching as {
      nextAction?: unknown;
      missions?: unknown[];
      beats?: { forkChoice?: unknown };
    };
    assert.equal(coaching.nextAction, null);
    assert.ok(Array.isArray(coaching.missions));
    assert.ok(coaching.missions.length >= 1);
    assert.equal(coaching.beats?.forkChoice, null);
    const stats = desk.activityStats as { bucket?: string };
    assert.equal(stats.bucket, "day");
  });

  it("does not expose another session user's interactions", async () => {
    const userA = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-boot-a",
      email: "boot-a@example.com",
      emailVerified: true,
    });
    const userB = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-boot-b",
      email: "boot-b@example.com",
      emailVerified: true,
    });
    await markInteracted({
      threadId: "thread-a",
      author: "@a",
      userId: userA.id,
    });
    await markInteracted({
      threadId: "thread-b",
      author: "@b",
      userId: userB.id,
    });
    const { token } = createSession(userA.id);

    const { status, body } = await get(
      "/api/boot",
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );
    assert.equal(status, 200);
    const desk = body.desk as {
      interacted: {
        interactions: Array<{ threadId: string }>;
        activeIds: string[];
      };
    };
    assert.deepEqual(
      desk.interacted.interactions.map((row) => row.threadId),
      ["thread-a"],
    );
    assert.deepEqual(desk.interacted.activeIds, ["thread-a"]);
  });
});
