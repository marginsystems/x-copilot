import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformDb, resetPlatformDbForTests, defaultMigrationsDir } from "./db.ts";
import { getUserForSessionToken, upsertOauthUser } from "./authStore.ts";
import {
  completeXLogin,
  fetchXAccessToken,
  fetchXRequestToken,
} from "./xAuth.ts";

describe("xAuth", () => {
  let dir: string;
  const prevHandle = process.env.AUTH_X_HANDLE_WHITELIST;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-xauth-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    process.env.AUTH_X_HANDLE_WHITELIST = "alice";
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    if (prevHandle === undefined) delete process.env.AUTH_X_HANDLE_WHITELIST;
    else process.env.AUTH_X_HANDLE_WHITELIST = prevHandle;
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses a request token response", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        "oauth_token=rt&oauth_token_secret=rs&oauth_callback_confirmed=true",
        { status: 200 },
      );
    const got = await fetchXRequestToken({
      consumerKey: "k",
      consumerSecret: "s",
      callbackUri: "http://127.0.0.1:8787/api/auth/x/callback",
      fetchImpl,
    });
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.token, "rt");
    assert.equal(got.secret, "rs");
  });

  it("parses access token identity without calling users/me", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        "oauth_token=at&oauth_token_secret=as&user_id=42&screen_name=alice",
        { status: 200 },
      );
    const got = await fetchXAccessToken({
      consumerKey: "k",
      consumerSecret: "s",
      token: "rt",
      tokenSecret: "rs",
      verifier: "vv",
      fetchImpl,
    });
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.profile.providerUserId, "42");
    assert.equal(got.profile.username, "alice");
  });

  it("allows X-only login when the handle is whitelisted", () => {
    const login = completeXLogin({
      profile: { providerUserId: "42", username: "alice" },
      existingUser: null,
    });
    assert.equal(login.ok, true);
    if (!login.ok) return;
    assert.equal(getUserForSessionToken(login.token)?.displayName, "alice");
  });

  it("requires Google when the handle is not whitelisted", () => {
    const denied = completeXLogin({
      profile: { providerUserId: "99", username: "eve" },
      existingUser: null,
    });
    assert.equal(denied.ok, false);
    if (denied.ok) return;
    assert.equal(denied.error, "google_required");
  });

  it("links X onto an existing Google session without a handle whitelist", () => {
    process.env.AUTH_X_HANDLE_WHITELIST = "";
    const google = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-x",
      email: "alice@example.com",
      emailVerified: true,
      displayName: "Alice G",
    });
    const login = completeXLogin({
      profile: { providerUserId: "42", username: "alice" },
      existingUser: google,
    });
    assert.equal(login.ok, true);
    if (!login.ok) return;
    assert.equal(getUserForSessionToken(login.token)?.id, google.id);
  });
});
