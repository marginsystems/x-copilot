import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformDb, resetPlatformDbForTests, defaultMigrationsDir } from "./db.ts";
import { getUserForSessionToken } from "./authStore.ts";
import {
  buildGoogleAuthorizeUrl,
  completeGoogleLogin,
  exchangeGoogleCode,
  type GoogleProfile,
} from "./googleAuth.ts";

describe("googleAuth", () => {
  let dir: string;
  const prevWhitelist = process.env.AUTH_EMAIL_WHITELIST;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-google-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    process.env.AUTH_EMAIL_WHITELIST = "alice@example.com";
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    if (prevWhitelist === undefined) delete process.env.AUTH_EMAIL_WHITELIST;
    else process.env.AUTH_EMAIL_WHITELIST = prevWhitelist;
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

  it("completes login only for verified whitelist emails", () => {
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
    assert.equal(getUserForSessionToken(ok.token)?.email, "alice@example.com");

    const denied = completeGoogleLogin({
      ...okProfile,
      sub: "gid-no",
      email: "eve@example.com",
    });
    assert.equal(denied.ok, false);
    if (denied.ok) return;
    assert.equal(denied.error, "not_whitelisted");

    const unverified = completeGoogleLogin({
      ...okProfile,
      sub: "gid-uv",
      emailVerified: false,
    });
    assert.equal(unverified.ok, false);
  });
});
