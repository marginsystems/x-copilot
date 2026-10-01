import { testRequest, testResponse, expectRecord, expectRecords } from "../http/http.testHelpers.js";

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
import { createSession, getSessionForToken, listSessionsForUser } from "./sessionStore.ts";
import { resetRateLimiterForTests } from "./authGuard.ts";
import { tryHandleAuth } from "./authHttp.ts";
import { getRequestSession, SESSION_COOKIE } from "./sessionCookie.ts";
import { EXTENSION_PAIR_RATE, EXTENSION_SESSION_PATH } from "./extensionSessionHttp.ts";

const LOCAL_ORIGIN = "http://127.0.0.1:5173";
const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

function request(opts: { method: string; cookie?: string; bearer?: string; origin?: string }) {
  const headers: Record<string, string> = { host: "127.0.0.1:8787", "user-agent": "Mozilla/5.0 Chrome/128.0.0.0" };
  if (opts.cookie) headers.cookie = `${SESSION_COOKIE}=${encodeURIComponent(opts.cookie)}`;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.origin) headers.origin = opts.origin;
  const req = Object.assign(testRequest(), { method: opts.method, headers });
  Object.defineProperty(req.socket, "remoteAddress", { value: "127.0.0.1" });
  return req;
}

async function call(opts: { method: string; cookie?: string; bearer?: string; origin?: string }) {
  const req = request(opts);
  const { res, captured } = testResponse(req);
  const handled = await tryHandleAuth(req, res, new URL(`http://localhost${EXTENSION_SESSION_PATH}`));
  assert.equal(handled, true);
  return {
    status: captured.status,
    headers: captured.headers,
    body: captured.raw ? expectRecord(JSON.parse(captured.raw)) : {},
  };
}

await describe("extension session pairing", async () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    resetRateLimiterForTests();
    dir = mkdtempSync(join(tmpdir(), "x-ext-session-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    resetRateLimiterForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  function user(suffix: string) {
    return upsertOauthUser({
      provider: "google",
      providerUserId: `gid-${suffix}`,
      email: `${suffix}@example.com`,
      emailVerified: true,
      displayName: suffix,
    });
  }

  await it("mints an extension token from a desk session that works only as a bearer", async () => {
    const alice = user("pair");
    const desk = createSession(alice.id);
    const res = await call({ method: "POST", cookie: desk.token, origin: LOCAL_ORIGIN });
    assert.equal(res.status, 201);
    assert.equal(res.headers["Cache-Control"], "no-store");
    const token = String(res.body.token);
    assert.ok(token.length >= 32);

    const viaBearer = getRequestSession(request({ method: "GET", bearer: token, origin: EXTENSION_ORIGIN }));
    assert.equal(viaBearer?.user.id, alice.id);
    assert.equal(viaBearer?.kind, "extension");
    assert.equal(getRequestSession(request({ method: "GET", cookie: token })), null);
    assert.equal(getRequestSession(request({ method: "GET", bearer: desk.token })), null);
  });

  await it("lists the extension session with its kind", async () => {
    const alice = user("list");
    const desk = createSession(alice.id);
    await call({ method: "POST", cookie: desk.token, origin: LOCAL_ORIGIN });
    const kinds = listSessionsForUser(alice.id).map((row) => row.kind).sort();
    assert.deepEqual(kinds, ["browser", "extension"]);
  });

  await it("refuses to pair without a desk session, from a foreign origin, or from an extension token", async () => {
    const alice = user("refuse");
    const desk = createSession(alice.id);
    assert.equal((await call({ method: "POST", origin: LOCAL_ORIGIN })).status, 401);
    assert.equal(
      (await call({ method: "POST", cookie: desk.token, origin: "https://evil.example" })).status,
      403,
    );
    const ext = createSession(alice.id, undefined, "extension");
    const chained = await call({ method: "POST", bearer: ext.token, origin: LOCAL_ORIGIN });
    assert.equal(chained.status, 403);
    assert.equal(chained.body.message, "Pair from the desk");
  });

  await it("rate limits pairing per user", async () => {
    const alice = user("rate");
    const desk = createSession(alice.id);
    for (let i = 0; i < EXTENSION_PAIR_RATE.max; i += 1) {
      assert.equal((await call({ method: "POST", cookie: desk.token, origin: LOCAL_ORIGIN })).status, 201);
    }
    assert.equal((await call({ method: "POST", cookie: desk.token, origin: LOCAL_ORIGIN })).status, 429);
  });

  await it("unpairs only with the extension's own bearer token", async () => {
    const alice = user("unpair");
    const desk = createSession(alice.id);
    const ext = createSession(alice.id, undefined, "extension");
    assert.equal((await call({ method: "DELETE", cookie: desk.token })).status, 401);
    assert.equal((await call({ method: "DELETE", bearer: ext.token, origin: EXTENSION_ORIGIN })).status, 200);
    assert.equal(getSessionForToken(ext.token, "extension"), null);
    assert.ok(getSessionForToken(desk.token));
    assert.equal((await call({ method: "DELETE", bearer: ext.token })).status, 401);
  });

  await it("shows the extension in the account session list", async () => {
    const alice = user("account");
    const desk = createSession(alice.id);
    createSession(alice.id, undefined, "extension");
    const req = request({ method: "GET", cookie: desk.token });
    const { res, captured } = testResponse(req);
    await tryHandleAuth(req, res, new URL("http://localhost/api/auth/sessions"));
    const sessions = expectRecords(expectRecord(JSON.parse(captured.raw)).sessions);
    assert.deepEqual(sessions.map((s) => s.kind).sort(), ["browser", "extension"]);
  });

  await it("answers other methods with 405", async () => {
    assert.equal((await call({ method: "GET" })).status, 405);
  });
});
