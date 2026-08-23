import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformDb, resetPlatformDbForTests, defaultMigrationsDir } from "./db.ts";
import { getUserForSessionToken } from "./sessionStore.ts";
import {
  buildGoogleAuthorizeUrl,
  completeGoogleLogin,
  exchangeGoogleCode,
  type GoogleProfile,
} from "./googleAuth.ts";

describe("googleAuth", () => {
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

  it("builds authorize URL with openid email profile", () => {
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

  it("exchanges code via injected fetch", async () => {
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

  it("treats a 200 non-JSON token body as exchange_failed", async () => {
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

  it("treats a 200 non-JSON userinfo body as userinfo_failed", async () => {
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

  it("completes login for any verified Google email", () => {
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
});
