import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformDb, resetPlatformDbForTests, defaultMigrationsDir } from "../db.ts";
import { upsertOauthUser } from "./oauthAccountStore.ts";
import { getUserForSessionToken } from "./sessionStore.ts";
import { createHmac } from "node:crypto";
import { expectRecord, testRequest, testResponse } from "../http/http.testHelpers.ts";
import { ownerHintForSession } from "./sessionCookie.ts";
import {
  completeXLogin,
  enlargeXAvatarUrl,
  fetchXAccessToken,
  fetchXProfileAvatar,
  fetchXRequestToken,
  handleXCallback,
  X_OAUTH_COOKIE,
} from "./xAuth.ts";

await describe("xAuth", async () => {
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

  await it("parses a request token response", async () => {
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

  await it("parses access token identity without calling users/me", async () => {
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

  await it("allows X-only login for any handle", () => {
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

  await it("enlarges the X _normal avatar crop", () => {
    assert.equal(
      enlargeXAvatarUrl(
        "https://pbs.twimg.com/profile_images/1/abc_normal.jpg",
      ),
      "https://pbs.twimg.com/profile_images/1/abc_400x400.jpg",
    );
  });

  await it("stores an X photo on an X-only login when provided", () => {
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

  await it("skips the live X avatar lookup under node:test", async () => {
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

  await it("reads profile_image_url when tests allow the lookup", async () => {
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

  await it("links X onto an existing Google session", () => {
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

  await it("does not overwrite an existing Google photo when linking X with an avatar", () => {
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

  await it("callback redirect sets the session and owner hint cookies together", async () => {
    const prev = {
      key: process.env.X_API_KEY,
      secret: process.env.X_API_SECRET,
    };
    process.env.X_API_KEY = "k";
    process.env.X_API_SECRET = "s";
    try {
      const body = JSON.stringify({ token: "rt", secret: "rs" });
      const sig = createHmac("sha256", "s").update(body).digest("hex");
      const cookie = `${X_OAUTH_COOKIE}=${encodeURIComponent(
        JSON.stringify({ token: "rt", secret: "rs", sig }),
      )}`;
      const fetchImpl: typeof fetch = async () =>
        new Response(
          "oauth_token=at&oauth_token_secret=as&user_id=77&screen_name=bob",
          { status: 200 },
        );
      const req = Object.assign(testRequest(), {
        method: "GET",
        headers: { host: "127.0.0.1:8787", cookie },
      });
      Object.defineProperty(req.socket, "remoteAddress", { value: "127.0.0.1" });
      const { res, captured } = testResponse(req);
      await handleXCallback(
        req,
        res,
        new URL("http://127.0.0.1:8787/api/auth/x/callback?oauth_token=rt&oauth_verifier=vv"),
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
    } finally {
      if (prev.key === undefined) delete process.env.X_API_KEY;
      else process.env.X_API_KEY = prev.key;
      if (prev.secret === undefined) delete process.env.X_API_SECRET;
      else process.env.X_API_SECRET = prev.secret;
    }
  });
});
