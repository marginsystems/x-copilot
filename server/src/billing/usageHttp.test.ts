import { testRequest, testResponse, expectRecord } from "../http/http.testHelpers.js";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authRequired, isPublicApiPath } from "../auth/authGuard.ts";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "../db.ts";
import { tryHandleUsage } from "./usageHttp.ts";

async function get(
  path: string,
): Promise<{ handled: boolean; status: number; body: Record<string, unknown> }> {
  const req = Object.assign(testRequest(), {
    method: "GET",
    headers: {}
  });
  Object.defineProperty(req.socket, "remoteAddress", { value: "127.0.0.1" });
  const { res, captured } = testResponse(req);
  const handled = await tryHandleUsage(
    req,
    res,
    new URL(`http://localhost${path}`),
  );
  return {
    handled,
    status: captured.status,
    body: captured.raw ? (expectRecord(JSON.parse(captured.raw))) : {},
  };
}

await describe("usageHttp", async () => {
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

  await it("GET /api/health without a cookie is 200 when AUTH_REQUIRED is on", async () => {
    assert.equal(authRequired(), true);
    assert.equal(isPublicApiPath("/api/health"), true);
    const { handled, status, body } = await get("/api/health");
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(typeof body.xApiConfigured, "boolean");
    assert.equal(typeof body.deepseekConfigured, "boolean");
  });

  await it("GET /health without a cookie is 200 when AUTH_REQUIRED is on", async () => {
    assert.equal(authRequired(), true);
    assert.equal(isPublicApiPath("/health"), true);
    const { handled, status, body } = await get("/health");
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  await it("GET /api/usage returns the tenant view", async () => {
    const { handled, status, body } = await get("/api/usage");
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  await it("ignores unrelated paths", async () => {
    const { handled, status } = await get("/api/scout/run");
    assert.equal(handled, false);
    assert.equal(status, 0);
  });
});
