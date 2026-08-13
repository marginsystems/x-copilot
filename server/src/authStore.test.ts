import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformDb, resetPlatformDbForTests, defaultMigrationsDir } from "./db.ts";
import {
  createSession,
  getUserById,
  getUserForSessionToken,
  linkOauthToUser,
  revokeSessionToken,
  upsertOauthUser,
} from "./authStore.ts";

describe("authStore", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-auth-"));
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

  it("creates a user from google oauth and issues a session", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-1",
      email: "alice@example.com",
      emailVerified: true,
      displayName: "Alice",
    });
    assert.equal(user.email, "alice@example.com");
    const { token } = createSession(user.id);
    const loaded = getUserForSessionToken(token);
    assert.equal(loaded?.id, user.id);
    assert.equal(loaded?.email, "alice@example.com");
  });

  it("links a second provider onto the same email user", () => {
    const google = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-2",
      email: "bob@example.com",
      emailVerified: true,
      displayName: "Bob",
    });
    const x = upsertOauthUser({
      provider: "x",
      providerUserId: "xid-2",
      email: "bob@example.com",
      emailVerified: true,
      username: "bobhandle",
    });
    assert.equal(x.id, google.id);
    assert.equal(x.email, "bob@example.com");
  });

  it("does not link a new provider onto an existing user without a verified email", () => {
    const google = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-4",
      email: "dave@example.com",
      emailVerified: true,
    });
    const x = upsertOauthUser({
      provider: "x",
      providerUserId: "xid-4",
      email: "dave@example.com",
      emailVerified: false,
    });
    assert.notEqual(x.id, google.id);
    assert.equal(google.email, "dave@example.com");
  });

  it("links X onto an existing Google user without sharing email", () => {
    const google = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-link",
      email: "dana@example.com",
      emailVerified: true,
    });
    const linked = linkOauthToUser({
      userId: google.id,
      provider: "x",
      providerUserId: "xid-link",
      username: "dana",
    });
    assert.equal(linked.ok, true);
    if (!linked.ok) return;
    assert.equal(linked.user.id, google.id);
    const stolen = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-other",
      email: "erin@example.com",
      emailVerified: true,
    });
    const clash = linkOauthToUser({
      userId: stolen.id,
      provider: "x",
      providerUserId: "xid-link",
      username: "dana",
    });
    assert.equal(clash.ok, false);
  });

  it("adopts an email-less X-only user when linking X to a Google user", () => {
    const xOnly = upsertOauthUser({
      provider: "x",
      providerUserId: "xid-anon",
      emailVerified: false,
      username: "anon",
    });
    assert.equal(xOnly.email, null);
    const { token } = createSession(xOnly.id);
    const google = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-anon",
      email: "gwen@example.com",
      emailVerified: true,
    });
    const linked = linkOauthToUser({
      userId: google.id,
      provider: "x",
      providerUserId: "xid-anon",
      username: "anon",
    });
    assert.equal(linked.ok, true);
    if (!linked.ok) return;
    assert.equal(linked.user.id, google.id);
    assert.equal(getUserById(xOnly.id), null);
    assert.equal(getUserForSessionToken(token), null);
  });

  it("revokes sessions", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-3",
      email: "carol@example.com",
      emailVerified: true,
    });
    const { token } = createSession(user.id);
    revokeSessionToken(token);
    assert.equal(getUserForSessionToken(token), null);
  });
});
