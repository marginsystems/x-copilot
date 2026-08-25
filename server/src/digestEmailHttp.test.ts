import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { tryHandleDigestEmail } from "./digestEmailHttp.ts";
import { getDigestEmailSettings } from "./digestEmailStore.ts";
import { makeUnsubscribeToken } from "./mail.ts";
import { upsertOauthUser } from "./oauthAccountStore.ts";
import { createSession } from "./sessionStore.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";

const LOCAL_ORIGIN = "http://127.0.0.1:5173";

async function call(opts: {
  method: string;
  path: string;
  token?: string;
  origin?: string;
  body?: unknown;
}): Promise<{ status: number; raw: string; body: Record<string, unknown> }> {
  let status = 0;
  let raw = "";
  const req = new PassThrough() as unknown as IncomingMessage;
  req.method = opts.method;
  req.headers = {};
  if (opts.token) {
    req.headers.cookie = `${SESSION_COOKIE}=${encodeURIComponent(opts.token)}`;
  }
  if (opts.origin) req.headers.origin = opts.origin;
  Object.defineProperty(req, "socket", {
    value: { remoteAddress: "127.0.0.1" },
  });
  const res = {
    writeHead(code: number) {
      status = code;
      return this;
    },
    end(chunk?: string) {
      raw = chunk ?? "";
      return this;
    },
  } as unknown as ServerResponse;
  const handled = tryHandleDigestEmail(
    req,
    res,
    new URL(`http://localhost${opts.path}`),
  );
  if (opts.body === undefined) {
    (req as unknown as PassThrough).end();
  } else {
    (req as unknown as PassThrough).end(JSON.stringify(opts.body));
  }
  assert.equal(await handled, true);
  let body: Record<string, unknown> = {};
  if (raw.startsWith("{")) body = JSON.parse(raw) as Record<string, unknown>;
  return { status, raw, body };
}

describe("digest email HTTP", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-mail-http-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    process.env.RESEND_API_KEY = "re_http_test";
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    delete process.env.RESEND_API_KEY;
    rmSync(dir, { recursive: true, force: true });
  });

  it("requires a session and allowed origin for preference changes", async () => {
    const missing = await call({
      method: "PATCH",
      path: "/api/mail/preferences",
      origin: LOCAL_ORIGIN,
      body: { digestEmailOptIn: true },
    });
    assert.equal(missing.status, 401);

    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "csrf-google",
      email: "csrf@example.com",
      emailVerified: true,
    });
    const session = createSession(user.id);
    const foreign = await call({
      method: "PATCH",
      path: "/api/mail/preferences",
      token: session.token,
      origin: "https://evil.example",
      body: { digestEmailOptIn: true },
    });
    assert.equal(foreign.status, 403);
  });

  it("opts a verified Google email in and X-only accounts out", async () => {
    const google = upsertOauthUser({
      provider: "google",
      providerUserId: "reader-google",
      email: "reader@example.com",
      emailVerified: true,
    });
    const googleSession = createSession(google.id);
    const enabled = await call({
      method: "PATCH",
      path: "/api/mail/preferences",
      token: googleSession.token,
      origin: LOCAL_ORIGIN,
      body: { digestEmailOptIn: true },
    });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.body.digestEmailOptIn, true);

    const xOnly = upsertOauthUser({
      provider: "x",
      providerUserId: "x-only",
      emailVerified: false,
      username: "xonly",
    });
    const xSession = createSession(xOnly.id);
    const rejected = await call({
      method: "PATCH",
      path: "/api/mail/preferences",
      token: xSession.token,
      origin: LOCAL_ORIGIN,
      body: { digestEmailOptIn: true },
    });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.error, "verified_email_required");
  });

  it("requires confirmation before a signed public link unsubscribes", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "unsubscribe-google",
      email: "unsubscribe@example.com",
      emailVerified: true,
    });
    getPlatformDb()
      .prepare(`UPDATE users SET digest_email_opt_in = 1 WHERE id = ?`)
      .run(user.id);
    const token = makeUnsubscribeToken(user.id);
    assert.ok(token);
    const preview = await call({
      method: "GET",
      path: `/api/mail/unsubscribe?t=${encodeURIComponent(token)}`,
    });
    assert.equal(preview.status, 200);
    assert.match(preview.raw, /Unsubscribe from Approach email/);
    assert.equal(getDigestEmailSettings(user.id)?.optedIn, true);

    const result = await call({
      method: "POST",
      path: `/api/mail/unsubscribe?t=${encodeURIComponent(token)}`,
    });
    assert.equal(result.status, 200);
    assert.match(result.raw, /Approach email is off/);
    assert.equal(getDigestEmailSettings(user.id)?.optedIn, false);
  });
});
