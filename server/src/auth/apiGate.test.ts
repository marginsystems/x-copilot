import { testRequest } from "../http/http.testHelpers.js";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "../db.ts";
import { upsertOauthUser } from "./oauthAccountStore.ts";
import { createSession } from "./sessionStore.ts";
import { apiGateRefusal } from "./apiGate.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";

const LOCAL_ORIGIN = "http://127.0.0.1:5173";
const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

function request(opts: { method: string; cookie?: string; bearer?: string; origin?: string }) {
  const headers: Record<string, string> = { host: "127.0.0.1:8787" };
  if (opts.cookie) headers.cookie = `${SESSION_COOKIE}=${encodeURIComponent(opts.cookie)}`;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.origin) headers.origin = opts.origin;
  const req = Object.assign(testRequest(), { method: opts.method, headers });
  Object.defineProperty(req.socket, "remoteAddress", { value: "127.0.0.1" });
  return req;
}

await describe("API gate", async () => {
  let dir: string;
  let previousAuthRequired: string | undefined;

  beforeEach(() => {
    previousAuthRequired = process.env.AUTH_REQUIRED;
    process.env.AUTH_REQUIRED = "1";
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-api-gate-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    getPlatformDb();
  });

  afterEach(() => {
    if (previousAuthRequired === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = previousAuthRequired;
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  function userId(suffix: string): string {
    return upsertOauthUser({
      provider: "google",
      providerUserId: `gid-${suffix}`,
      email: `${suffix}@example.com`,
      emailVerified: true,
      displayName: suffix,
    }).id;
  }

  await it("lets a desk cookie through from an allowed origin", () => {
    const desk = createSession(userId("desk"));
    assert.equal(apiGateRefusal(request({ method: "POST", cookie: desk.token, origin: LOCAL_ORIGIN }), "/api/coaching"), null);
  });

  await it("refuses a desk cookie from a foreign origin on reads and writes", () => {
    const desk = createSession(userId("csrf"));
    for (const method of ["GET", "POST", "PUT"]) {
      assert.equal(
        apiGateRefusal(request({ method, cookie: desk.token, origin: "https://evil.example" }), "/api/coaching")?.status,
        403,
      );
    }
  });

  await it("lets an extension bearer through from the extension's own origin", () => {
    const ext = createSession(userId("ext"), undefined, "extension");
    for (const method of ["GET", "POST", "PUT"]) {
      assert.equal(
        apiGateRefusal(request({ method, bearer: ext.token, origin: EXTENSION_ORIGIN }), "/api/coaching"),
        null,
      );
    }
  });

  await it("answers 401, not 403, to a bearer that is unknown or a desk cookie token", () => {
    const desk = createSession(userId("swap"));
    assert.equal(apiGateRefusal(request({ method: "GET", bearer: "nope", origin: EXTENSION_ORIGIN }), "/api/coaching")?.status, 401);
    assert.equal(apiGateRefusal(request({ method: "GET", bearer: desk.token, origin: EXTENSION_ORIGIN }), "/api/coaching")?.status, 401);
  });

  await it("skips public paths", () => {
    assert.equal(apiGateRefusal(request({ method: "GET", origin: "https://evil.example" }), "/api/health"), null);
  });
});
