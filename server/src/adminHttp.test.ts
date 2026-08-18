import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { createSession, upsertOauthUser } from "./authStore.ts";
import { ensureUserTenant } from "./billingStore.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";
import { tryHandleAdmin } from "./adminHttp.ts";

describe("POST /api/admin/grants", () => {
  let dir: string;
  const prevAdmin = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-admin-grant-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    process.env.ADMIN_EMAILS = "margin707@gmail.com";
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    if (prevAdmin === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = prevAdmin;
    rmSync(dir, { recursive: true, force: true });
  });

  async function postGrant(
    cookieEmail: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const actor = upsertOauthUser({
      provider: "google",
      providerUserId: `gid-${cookieEmail}`,
      email: cookieEmail,
      emailVerified: true,
    });
    const { token } = createSession(actor.id);
    const req = new EventEmitter() as unknown as IncomingMessage;
    Object.assign(req, {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
        origin: "http://localhost:5173",
      },
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
    const handledPromise = tryHandleAdmin(
      req,
      res,
      new URL("http://localhost/api/admin/grants"),
    );
    (req as EventEmitter).emit("data", Buffer.from(JSON.stringify(body)));
    (req as EventEmitter).emit("end");
    assert.equal(await handledPromise, true);
    return { status, json: JSON.parse(raw || "{}") as Record<string, unknown> };
  }

  it("lets an admin grant Pulse by X handle", async () => {
    upsertOauthUser({
      provider: "x",
      providerUserId: "xid-will",
      username: "willizuchukwu",
      email: "will@example.com",
      emailVerified: true,
    });
    const target = upsertOauthUser({
      provider: "x",
      providerUserId: "xid-will",
      username: "willizuchukwu",
      email: "will@example.com",
      emailVerified: true,
    });
    ensureUserTenant(target.id);
    const { status, json } = await postGrant("margin707@gmail.com", {
      handle: "willizuchukwu",
      plan: "pulse",
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.plan_key, "pulse");
    const grant = json.grant as { plan_key?: string; notice?: string };
    assert.equal(grant.plan_key, "pulse");
    assert.match(String(json.notice ?? grant.notice), /manually upgraded to Pulse/);
  });

  it("rejects a non-admin", async () => {
    const { status, json } = await postGrant("eve@example.com", {
      handle: "willizuchukwu",
      plan: "pulse",
    });
    assert.equal(status, 403);
    assert.equal(json.error, "forbidden");
  });
});
