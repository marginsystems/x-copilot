import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { authRequired, isPublicApiPath } from "./authGuard.ts";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { tryHandleUsage } from "./usageHttp.ts";

async function get(
  path: string,
): Promise<{ handled: boolean; status: number; body: Record<string, unknown> }> {
  let status = 0;
  let raw = "";
  const req = {
    method: "GET",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
  const res = {
    writeHead: (code: number) => {
      status = code;
    },
    end: (chunk: string) => {
      raw = chunk;
    },
  } as unknown as ServerResponse;
  const handled = await tryHandleUsage(
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

describe("usageHttp", () => {
  const prevAuth = process.env.AUTH_REQUIRED;
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-usage-http-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    process.env.AUTH_REQUIRED = "1";
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    if (prevAuth === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = prevAuth;
    rmSync(dir, { recursive: true, force: true });
  });

  it("GET /api/health without a cookie is 200 when AUTH_REQUIRED is on", async () => {
    assert.equal(authRequired(), true);
    assert.equal(isPublicApiPath("/api/health"), true);
    const { handled, status, body } = await get("/api/health");
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(typeof body.xApiConfigured, "boolean");
    assert.equal(typeof body.deepseekConfigured, "boolean");
  });

  it("GET /health without a cookie is 200 when AUTH_REQUIRED is on", async () => {
    assert.equal(authRequired(), true);
    assert.equal(isPublicApiPath("/health"), true);
    const { handled, status, body } = await get("/health");
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it("GET /api/usage returns the tenant view", async () => {
    const { handled, status, body } = await get("/api/usage");
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it("ignores unrelated paths", async () => {
    const { handled, status } = await get("/api/scout/run");
    assert.equal(handled, false);
    assert.equal(status, 0);
  });
});
