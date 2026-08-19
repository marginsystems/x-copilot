import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformDb, resetPlatformDbForTests, defaultMigrationsDir } from "./db.ts";
import { getUserForSessionToken, upsertOauthUser } from "./authStore.ts";
import {
  completeXLogin,
  enlargeXAvatarUrl,
  fetchXAccessToken,
  fetchXProfileAvatar,
  fetchXRequestToken,
} from "./xAuth.ts";

describe("xAuth", () => {
  let dir: string;
  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-xauth-"));
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
    assert.equal(got.token, "at");
    assert.equal(got.secret, "as");
  });

  it("allows X-only login for any handle", () => {
    const login = completeXLogin({
      profile: { providerUserId: "42", username: "alice" },
      existingUser: null,
    });
    assert.equal(login.ok, true);
    if (!login.ok) return;
    assert.equal(login.created, true);
    assert.equal(getUserForSessionToken(login.token)?.displayName, "alice");
    const again = completeXLogin({
      profile: { providerUserId: "42", username: "alice" },
      existingUser: null,
    });
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.created, false);
    assert.equal(again.user.id, login.user.id);

    const other = completeXLogin({
      profile: { providerUserId: "99", username: "eve" },
      existingUser: null,
    });
    assert.equal(other.ok, true);
    if (!other.ok) return;
    assert.equal(getUserForSessionToken(other.token)?.displayName, "eve");
  });

  it("enlarges the X _normal avatar crop", () => {
    assert.equal(
      enlargeXAvatarUrl(
        "https://pbs.twimg.com/profile_images/1/abc_normal.jpg",
      ),
      "https://pbs.twimg.com/profile_images/1/abc_400x400.jpg",
    );
  });

  it("stores an X photo on an X-only login when provided", () => {
    const login = completeXLogin({
      profile: {
        providerUserId: "42",
        username: "alice",
        avatarUrl: "https://pbs.twimg.com/profile_images/1/abc_400x400.jpg",
      },
      existingUser: null,
    });
    assert.equal(login.ok, true);
    if (!login.ok) return;
    assert.equal(
      getUserForSessionToken(login.token)?.avatarUrl,
      "https://pbs.twimg.com/profile_images/1/abc_400x400.jpg",
    );
  });

  it("skips the live X avatar lookup under node:test", async () => {
    const avatar = await fetchXProfileAvatar(
      "alice",
      async () =>
        new Response(
          JSON.stringify({
            data: {
              profile_image_url:
                "https://pbs.twimg.com/profile_images/1/abc_normal.jpg",
            },
          }),
          { status: 200 },
        ),
      { NODE_TEST_CONTEXT: "1", X_API_BEARER_TOKEN: "bearer" },
    );
    assert.equal(avatar, null);
  });

  it("reads profile_image_url when tests allow the lookup", async () => {
    const avatar = await fetchXProfileAvatar(
      "alice",
      async () =>
        new Response(
          JSON.stringify({
            data: {
              profile_image_url:
                "https://pbs.twimg.com/profile_images/1/abc_normal.jpg",
            },
          }),
          { status: 200 },
        ),
      { NODE_TEST_CONTEXT: "", X_API_BEARER_TOKEN: "bearer" },
    );
    assert.equal(
      avatar,
      "https://pbs.twimg.com/profile_images/1/abc_400x400.jpg",
    );
  });

  it("links X onto an existing Google session", () => {
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
    assert.equal(
      getUserForSessionToken(login.token)?.displayName,
      "Alice G",
    );
  });

  it("does not overwrite an existing Google photo when linking X with an avatar", () => {
    const google = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-x",
      email: "alice@example.com",
      emailVerified: true,
      displayName: "Alice G",
      avatarUrl: "https://google.example.com/alice.jpg",
    });
    const login = completeXLogin({
      profile: {
        providerUserId: "42",
        username: "alice",
        avatarUrl: "https://pbs.twimg.com/profile_images/1/abc_400x400.jpg",
      },
      existingUser: google,
    });
    assert.equal(login.ok, true);
    if (!login.ok) return;
    assert.equal(
      getUserForSessionToken(login.token)?.avatarUrl,
      "https://google.example.com/alice.jpg",
    );
  });
});
