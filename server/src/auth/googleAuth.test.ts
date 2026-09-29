import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformDb, resetPlatformDbForTests, defaultMigrationsDir } from "../db.ts";
import { getUserForSessionToken } from "./sessionStore.ts";
import { expectRecord, testRequest, testResponse } from "../http/http.testHelpers.ts";
import { ownerHintForSession } from "./sessionCookie.ts";
import {
  buildGoogleAuthorizeUrl,
  completeGoogleLogin,
  exchangeGoogleCode,
  handleGoogleCallback,
  type GoogleProfile,
} from "./googleAuth.ts";

await describe("googleAuth", async () => {
  let dir: string;
  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-google-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  await it("builds authorize URL with openid email profile", () => {
    const url = buildGoogleAuthorizeUrl({
      clientId: "cid.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:8787/api/auth/google/callback",
      state: "st",
    });
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://accounts.google.com");
    assert.equal(parsed.searchParams.get("client_id"), "cid.apps.googleusercontent.com");
    assert.equal(parsed.searchParams.get("response_type"), "code");
    assert.equal(parsed.searchParams.get("scope"), "openid email profile");
    assert.equal(parsed.searchParams.get("state"), "st");
  });

  await it("exchanges code via injected fetch", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/token")) {
        assert.equal(init?.method, "POST");
        return new Response(JSON.stringify({ access_token: "at" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("userinfo")) {
        return new Response(
          JSON.stringify({
            sub: "gid-9",
            email: "alice@example.com",
            email_verified: true,
            name: "Alice",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("nope", { status: 404 });
    };
    const result = await exchangeGoogleCode({
      code: "code-1",
      clientId: "cid",
      clientSecret: "sec",
      redirectUri: "http://127.0.0.1:8787/api/auth/google/callback",
      fetchImpl,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.sub, "gid-9");
    assert.equal(result.profile.email, "alice@example.com");
    assert.equal(calls.length, 2);
  });

  await it("treats a 200 non-JSON token body as exchange_failed", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/token")) {
        return new Response("<html>oops</html>", { status: 200 });
      }
      return new Response("nope", { status: 404 });
    };
    const result = await exchangeGoogleCode({
      code: "code-1",
      clientId: "cid",
      clientSecret: "sec",
      redirectUri: "http://127.0.0.1:8787/api/auth/google/callback",
      fetchImpl,
    });
    assert.equal(result.ok, false);
  });

  await it("rejects a non-string access token", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).includes("/token")) {
        return new Response(JSON.stringify({ access_token: 42 }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    };
    const result = await exchangeGoogleCode({
      code: "code-1",
      clientId: "cid",
      clientSecret: "sec",
      redirectUri: "http://127.0.0.1:8787/api/auth/google/callback",
      fetchImpl,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "missing_access_token");
  });

  await it("treats a 200 non-JSON userinfo body as userinfo_failed", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/token")) {
        return new Response(JSON.stringify({ access_token: "at" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("userinfo")) {
        return new Response("<html>oops</html>", { status: 200 });
      }
      return new Response("nope", { status: 404 });
    };
    const result = await exchangeGoogleCode({
      code: "code-1",
      clientId: "cid",
      clientSecret: "sec",
      redirectUri: "http://127.0.0.1:8787/api/auth/google/callback",
      fetchImpl,
    });
    assert.equal(result.ok, false);
  });

  await it("rejects a non-string userinfo subject", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/token")) {
        return new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
      }
      if (url.includes("userinfo")) {
        return new Response(JSON.stringify({ sub: 42 }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    };
    const result = await exchangeGoogleCode({
      code: "code-1",
      clientId: "cid",
      clientSecret: "sec",
      redirectUri: "http://127.0.0.1:8787/api/auth/google/callback",
      fetchImpl,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "missing_sub");
  });

  await it("completes login for any verified Google email", () => {
    const okProfile: GoogleProfile = {
      sub: "gid-ok",
      email: "alice@example.com",
      emailVerified: true,
      name: "Alice",
      picture: null,
    };
    const ok = completeGoogleLogin(okProfile);
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.created, true);
    assert.equal(getUserForSessionToken(ok.token)?.email, "alice@example.com");
    const again = completeGoogleLogin(okProfile);
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.created, false);
    assert.equal(again.user.id, ok.user.id);

    const other = completeGoogleLogin({
      ...okProfile,
      sub: "gid-eve",
      email: "eve@example.com",
    });
    assert.equal(other.ok, true);
    if (!other.ok) return;
    assert.equal(getUserForSessionToken(other.token)?.email, "eve@example.com");

    const unverified = completeGoogleLogin({
      ...okProfile,
      sub: "gid-uv",
      emailVerified: false,
    });
    assert.equal(unverified.ok, false);
  });

  await it("callback redirect sets the session and owner hint cookies together", async () => {
    const prev = {
      id: process.env.GOOGLE_CLIENT_ID,
      secret: process.env.GOOGLE_CLIENT_SECRET,
    };
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "sec";
    try {
      const fetchImpl: typeof fetch = async (input) =>
        String(input).includes("/token")
          ? new Response(JSON.stringify({ access_token: "at" }), { status: 200 })
          : new Response(
              JSON.stringify({
                sub: "gid-cb",
                email: "cb@example.com",
                email_verified: true,
                name: "Cb",
              }),
              { status: 200 },
            );
      const req = Object.assign(testRequest(), {
        method: "GET",
        headers: { host: "127.0.0.1:8787", cookie: "xc_oauth_state=st1" },
      });
      Object.defineProperty(req.socket, "remoteAddress", { value: "127.0.0.1" });
      const { res, captured } = testResponse(req);
      await handleGoogleCallback(
        req,
        res,
        new URL("http://127.0.0.1:8787/api/auth/google/callback?code=c&state=st1"),
        fetchImpl,
      );
      assert.equal(captured.status, 302);
      const rawCookies = captured.headers["Set-Cookie"];
      assert.ok(Array.isArray(rawCookies));
      const cookies = rawCookies.map(String);
      const session = cookies.find((c) => c.startsWith("xc_session="));
      const owner = cookies.find((c) => c.startsWith("xc_owner="));
      assert.ok(session);
      assert.ok(owner);
      const token = decodeURIComponent(session.split(";")[0]!.slice("xc_session=".length));
      const user = getUserForSessionToken(token);
      assert.ok(user);
      const sessionRow = expectRecord(
        getPlatformDb()
          .prepare(`SELECT id FROM sessions WHERE user_id = ?`)
          .get(user.id),
      );
      assert.ok(owner.startsWith(`xc_owner=${ownerHintForSession(String(sessionRow.id))};`));
      assert.match(owner, /Max-Age=2592000/);
      assert.doesNotMatch(owner, /HttpOnly/);
    } finally {
      if (prev.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = prev.id;
      if (prev.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = prev.secret;
    }
  });
});
