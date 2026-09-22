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
import { createSession } from "./sessionStore.ts";
import { resetRateLimiterForTests } from "./authGuard.ts";
import { tryHandleAuth } from "./authHttp.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";

const LOCAL_ORIGIN = "http://127.0.0.1:5173";

async function call(opts: {
  method: string;
  path: string;
  token?: string;
  origin?: string;
  ua?: string;
}): Promise<{ status: number; body: Record<string, unknown>; setCookie: string }> {
  const headers: Record<string, string> = {};
  if (opts.token) {
    headers.cookie = `${SESSION_COOKIE}=${encodeURIComponent(opts.token)}`;
  }
  if (opts.origin) headers.origin = opts.origin;
  if (opts.ua) headers["user-agent"] = opts.ua;
  const req = Object.assign(testRequest(), {
    method: opts.method,
    headers
  });
  Object.defineProperty(req.socket, "remoteAddress", { value: "127.0.0.1" });
  const { res, captured } = testResponse(req);
  const handled = await tryHandleAuth(
    req,
    res,
    new URL(`http://localhost${opts.path}`),
  );
  assert.equal(handled, true);
  return {
    status: captured.status,
    body: captured.raw ? (expectRecord(JSON.parse(captured.raw))) : {},
    setCookie: Array.isArray(captured.headers["Set-Cookie"])
      ? captured.headers["Set-Cookie"].map(String).join("\n")
      : typeof captured.headers["Set-Cookie"] === "string" ? captured.headers["Set-Cookie"] : "",
  };
}

await describe("sessions HTTP", async () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    resetRateLimiterForTests();
    dir = mkdtempSync(join(tmpdir(), "x-sessions-"));
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

  await it("returns 401 without a session", async () => {
    const res = await call({ method: "GET", path: "/api/auth/sessions" });
    assert.equal(res.status, 401);
  });

  await it("lists this device as current and never returns a token hash", async () => {
    const alice = user("list");
    const sess = createSession(alice.id, {
      ip: "203.0.113.8",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
    });
    const res = await call({
      method: "GET",
      path: "/api/auth/sessions",
      token: sess.token,
    });
    assert.equal(res.status, 200);
    const sessions = expectRecords(res.body.sessions);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, sess.id);
    assert.equal(sessions[0].current, true);
    assert.equal(sessions[0].browser, "Chrome");
    assert.equal(sessions[0].os, "macOS");
    assert.equal(sessions[0].ip, "203.0.113.8");
    const dumped = JSON.stringify(res.body);
    assert.equal(dumped.includes(sess.token), false);
    assert.equal(dumped.includes("token_hash"), false);
    assert.equal(dumped.includes("tokenHash"), false);
  });

  await it("loads account profile, providers, and sessions in one trip", async () => {
    const alice = user("account");
    const sess = createSession(alice.id);
    const res = await call({
      method: "GET",
      path: "/api/auth/account",
      token: sess.token,
    });
    assert.equal(res.status, 200);
    const userBody = expectRecord(res.body.user);
    assert.equal(userBody.email, "account@example.com");
    const providers = expectRecords(res.body.providers);
    assert.equal(providers.some((p) => p.provider === "google"), true);
    assert.deepEqual(res.body.mail, {
      digestEmailOptIn: false,
      digestEmailAvailable: true,
    });
    assert.equal(JSON.stringify(res.body).includes("gid-account"), false);
  });

  await it("rejects revoke mutations from a foreign origin", async () => {
    const alice = user("csrf");
    const sess = createSession(alice.id);
    const res = await call({
      method: "POST",
      path: "/api/auth/sessions/revoke-others",
      token: sess.token,
      origin: "https://evil.example",
    });
    assert.equal(res.status, 403);
    assert.ok(getPlatformDb()
      .prepare(`SELECT id FROM sessions WHERE id = ? AND revoked_at IS NULL`)
      .get(sess.id));
  });

  await it("keeps this device when revoking others", async () => {
    const alice = user("keep");
    const keep = createSession(alice.id);
    const other = createSession(alice.id);
    const res = await call({
      method: "POST",
      path: "/api/auth/sessions/revoke-others",
      token: keep.token,
      origin: LOCAL_ORIGIN,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.revoked, 1);
    const sessions = expectRecords(res.body.sessions);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, keep.id);
    assert.equal(sessions[0].current, true);
    const otherRow = expectRecord(getPlatformDb()
      .prepare(`SELECT revoked_at FROM sessions WHERE id = ?`)
      .get(other.id));
    assert.ok(otherRow.revoked_at);
  });

  await it("returns 404 when another user guesses a session UUID", async () => {
    const alice = user("owner");
    const eve = user("thief");
    const aliceSess = createSession(alice.id);
    const eveSess = createSession(eve.id);
    const res = await call({
      method: "DELETE",
      path: `/api/auth/sessions/${aliceSess.id}`,
      token: eveSess.token,
      origin: LOCAL_ORIGIN,
    });
    assert.equal(res.status, 404);
    const still = expectRecord(getPlatformDb()
      .prepare(`SELECT revoked_at FROM sessions WHERE id = ?`)
      .get(aliceSess.id));
    assert.equal(still.revoked_at, null);
  });

  await it("clears the cookie when this device is revoked", async () => {
    const alice = user("self");
    const sess = createSession(alice.id);
    const res = await call({
      method: "DELETE",
      path: `/api/auth/sessions/${sess.id}`,
      token: sess.token,
      origin: LOCAL_ORIGIN,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.signedOut, true);
    assert.match(res.setCookie, /xc_session=/);
    assert.match(res.setCookie, /Max-Age=0/);
  });

  await it("rate-limits revoke tightly", async () => {
    const alice = user("rate");
    const keep = createSession(alice.id);
    let last = { status: 0 };
    for (let i = 0; i < 11; i += 1) {
      last = await call({
        method: "POST",
        path: "/api/auth/sessions/revoke-others",
        token: keep.token,
        origin: LOCAL_ORIGIN,
      });
    }
    assert.equal(last.status, 429);
  });

  await it("rejects typed X username updates", async () => {
    const alice = user("typed");
    const sess = createSession(alice.id);
    const res = await call({
      method: "POST",
      path: "/api/auth/x-username",
      token: sess.token,
      origin: LOCAL_ORIGIN,
    });
    assert.equal(res.status, 404);
  });
});
