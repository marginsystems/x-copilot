import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformDb, resetPlatformDbForTests, defaultMigrationsDir } from "./db.ts";
import { ensureUserTenant, getUserBilling } from "./billingStore.ts";
import { activateSubscription } from "./stripeSubscriptionStore.ts";
import {
  completeOnboarding,
  getUserById,
  setUserXUsername,
  toPublicUser,
} from "./authStore.ts";
import {
  findOauthAccount,
  linkOauthToUser,
  listOauthProviders,
  upsertOauthIdentity,
  upsertOauthUser,
} from "./oauthAccountStore.ts";
import {
  saveXWriteCreds,
  userNeedsXHandle,
} from "./xIdentityStore.ts";
import {
  createSession,
  getUserForSessionToken,
  listSessionsForUser,
  revokeOtherSessions,
  revokeSessionById,
  revokeSessionToken,
  touchSessionMeta,
} from "./sessionStore.ts";
import { toPublicSession } from "./sessionView.ts";

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

  it("flags created only for a new users row", () => {
    const first = upsertOauthIdentity({
      provider: "google",
      providerUserId: "gid-new",
      email: "new@example.com",
      emailVerified: true,
      displayName: "New",
    });
    assert.equal(first.created, true);
    const again = upsertOauthIdentity({
      provider: "google",
      providerUserId: "gid-new",
      email: "new@example.com",
      emailVerified: true,
    });
    assert.equal(again.created, false);
    assert.equal(again.user.id, first.user.id);
    const linked = upsertOauthIdentity({
      provider: "x",
      providerUserId: "xid-new",
      email: "new@example.com",
      emailVerified: true,
      username: "newhandle",
    });
    assert.equal(linked.created, false);
    assert.equal(linked.user.id, first.user.id);
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

  it("does not adopt an email-less X-only user with a live Stripe subscription", () => {
    const xOnly = upsertOauthUser({
      provider: "x",
      providerUserId: "xid-paid",
      emailVerified: false,
      username: "paidanon",
    });
    assert.equal(xOnly.email, null);
    ensureUserTenant(xOnly.id);
    activateSubscription({
      userId: xOnly.id,
      planKey: "pulse",
      stripeCustomerId: "cus-paid",
      stripeSubscriptionId: "sub-paid",
      subscriptionStatus: "active",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    const google = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-paid",
      email: "pat@example.com",
      emailVerified: true,
    });
    const linked = linkOauthToUser({
      userId: google.id,
      provider: "x",
      providerUserId: "xid-paid",
      username: "paidanon",
    });
    assert.equal(linked.ok, false);
    assert.equal(getUserById(xOnly.id)?.id, xOnly.id);
    assert.equal(getUserBilling(xOnly.id)?.stripeSubscriptionId, "sub-paid");
    assert.equal(
      findOauthAccount("x", "xid-paid")?.userId,
      xOnly.id,
    );
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

  it("leaves new users unonboarded until they complete setup", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-onboard-1",
      email: "new@example.com",
      emailVerified: true,
    });
    assert.equal(user.onboardingCompletedAt, null);
    assert.equal(user.agenda, null);
  });

  it("persists agenda and completion timestamp", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-onboard-2",
      email: "setup@example.com",
      emailVerified: true,
    });
    const agenda =
      "Find founders sharing concrete takes on shipping AI tools in public. Prefer a clear point of view. Skip empty engagement bait.";
    const updated = completeOnboarding(user.id, `  ${agenda}  `);
    assert.ok(updated);
    assert.equal(updated?.agenda, agenda);
    assert.ok(updated?.onboardingCompletedAt);
    const again = completeOnboarding(
      user.id,
      "Meet researchers arguing about evaluation, not model drops. Prefer lived results. Skip launch-day hype threads.",
    );
    assert.equal(again?.onboardingCompletedAt, updated?.onboardingCompletedAt);
    assert.match(again?.agenda ?? "", /evaluation/);
  });

  it("returns null when completing onboarding for a missing user", () => {
    assert.equal(
      completeOnboarding("missing", "Find builders sharing opinions on shipping."),
      null,
    );
  });

  it("stamps X username from X login and skips the handle step", () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "xid-handle",
      emailVerified: false,
      username: "@MarginSystems",
      displayName: "Margin",
    });
    assert.equal(user.xUsername, "MarginSystems");
    assert.equal(userNeedsXHandle(user), false);
  });

  it("requires official X OAuth for Google-only users", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-handle",
      email: "g@example.com",
      emailVerified: true,
    });
    assert.equal(user.xUsername, null);
    assert.equal(userNeedsXHandle(user), true);
    const agenda =
      "Find founders sharing concrete takes on shipping AI tools in public. Prefer a clear point of view. Skip empty engagement bait.";
    const updated = completeOnboarding(user.id, agenda);
    assert.equal(updated?.xUsername, null);
    assert.equal(userNeedsXHandle(updated!), true);
    const linked = linkOauthToUser({
      userId: user.id,
      provider: "x",
      providerUserId: "xid-handle",
      username: "alice_dev",
    });
    assert.equal(linked.ok, true);
    assert.equal(userNeedsXHandle(getUserById(user.id)!), false);
  });

  it("can stamp a public handle from official X identity helpers", () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "xid-settings",
      emailVerified: false,
      username: "oldname",
    });
    assert.equal(user.xUsername, "oldname");
    const updated = setUserXUsername(user.id, "@NewName");
    assert.equal(updated?.xUsername, "NewName");
    assert.equal(setUserXUsername("missing", "still_here"), null);
  });

  it("records created IP/UA once and only bumps last-seen on use", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-meta",
      email: "meta@example.com",
      emailVerified: true,
    });
    const created = createSession(user.id, {
      ip: "203.0.113.10",
      userAgent: "CreatedUA/1.0",
    });
    const listed = listSessionsForUser(user.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, created.id);
    assert.equal(listed[0].createdIp, "203.0.113.10");
    assert.equal(listed[0].createdUserAgent, "CreatedUA/1.0");
    assert.equal(listed[0].lastSeenIp, "203.0.113.10");
    touchSessionMeta(created.id, user.id, {
      ip: "198.51.100.20",
      userAgent: "RefreshUA/2.0",
    });
    const throttled = listSessionsForUser(user.id)[0];
    assert.equal(throttled.createdIp, "203.0.113.10");
    assert.equal(throttled.createdUserAgent, "CreatedUA/1.0");
    assert.equal(throttled.lastSeenIp, "203.0.113.10");
    getPlatformDb()
      .prepare(`UPDATE session_meta SET last_seen_at = ? WHERE session_id = ?`)
      .run(new Date(Date.now() - 61_000).toISOString(), created.id);
    touchSessionMeta(created.id, user.id, {
      ip: "198.51.100.20",
      userAgent: "RefreshUA/2.0",
    });
    const after = listSessionsForUser(user.id)[0];
    assert.equal(after.createdIp, "203.0.113.10");
    assert.equal(after.createdUserAgent, "CreatedUA/1.0");
    assert.equal(after.lastSeenIp, "198.51.100.20");
    assert.equal(after.lastSeenUserAgent, "RefreshUA/2.0");
  });

  it("does not backfill created IP/UA for sessions missing a meta row", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-meta-fallback",
      email: "meta-fallback@example.com",
      emailVerified: true,
    });
    const created = createSession(user.id, {
      ip: "203.0.113.10",
      userAgent: "CreatedUA/1.0",
    });
    getPlatformDb()
      .prepare(`DELETE FROM session_meta WHERE session_id = ?`)
      .run(created.id);
    touchSessionMeta(created.id, user.id, {
      ip: "198.51.100.20",
      userAgent: "RefreshUA/2.0",
    });
    const listed = listSessionsForUser(user.id)[0];
    assert.equal(listed.createdIp, null);
    assert.equal(listed.createdUserAgent, null);
    assert.equal(listed.lastSeenIp, "198.51.100.20");
    assert.equal(listed.lastSeenUserAgent, "RefreshUA/2.0");
  });

  it("lists only this user's sessions and never exposes a token hash", () => {
    const alice = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-alice-sess",
      email: "alice-sess@example.com",
      emailVerified: true,
    });
    const eve = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-eve-sess",
      email: "eve-sess@example.com",
      emailVerified: true,
    });
    const aliceSess = createSession(alice.id, { ip: "1.1.1.1" });
    createSession(eve.id, { ip: "9.9.9.9" });
    const listed = listSessionsForUser(alice.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, aliceSess.id);
    const pub = toPublicSession(listed[0], aliceSess.id);
    const dumped = JSON.stringify({ listed, pub });
    assert.equal(dumped.includes("token"), false);
    assert.equal(dumped.includes("hash"), false);
    assert.equal("tokenHash" in listed[0], false);
  });

  it("revokes by id only when the session belongs to that user", () => {
    const alice = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-alice-rev",
      email: "alice-rev@example.com",
      emailVerified: true,
    });
    const eve = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-eve-rev",
      email: "eve-rev@example.com",
      emailVerified: true,
    });
    const aliceSess = createSession(alice.id);
    const eveSess = createSession(eve.id);
    assert.equal(revokeSessionById(eve.id, aliceSess.id), false);
    assert.ok(getUserForSessionToken(aliceSess.token));
    assert.equal(revokeSessionById(alice.id, aliceSess.id), true);
    assert.equal(getUserForSessionToken(aliceSess.token), null);
    assert.ok(getUserForSessionToken(eveSess.token));
  });

  it("revokes other sessions and keeps this device", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-keep",
      email: "keep@example.com",
      emailVerified: true,
    });
    const keep = createSession(user.id);
    const other = createSession(user.id);
    assert.equal(revokeOtherSessions(user.id, keep.id), 1);
    assert.ok(getUserForSessionToken(keep.token));
    assert.equal(getUserForSessionToken(other.token), null);
    const listed = listSessionsForUser(user.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, keep.id);
  });

  it("lists linked providers without provider user ids", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-providers",
      email: "prov@example.com",
      emailVerified: true,
      displayName: "Prov",
    });
    const linked = linkOauthToUser({
      userId: user.id,
      provider: "x",
      providerUserId: "xid-providers",
      username: "provhandle",
    });
    assert.equal(linked.ok, true);
    const providers = listOauthProviders(user.id);
    assert.deepEqual(
      providers.map((p) => p.provider).sort(),
      ["google", "x"],
    );
    assert.equal(
      JSON.stringify(providers).includes("gid-providers"),
      false,
    );
    assert.equal(
      JSON.stringify(providers).includes("xid-providers"),
      false,
    );
  });

  it("exposes xCanPost only after X write tokens are saved", () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "xid-write",
      username: "writer",
      email: "writer@example.com",
      emailVerified: true,
    });
    assert.equal(toPublicUser(user).xCanPost, false);
    assert.equal(
      saveXWriteCreds(user.id, "xid-write", { token: "at", secret: "as" }),
      true,
    );
    assert.equal(toPublicUser(user).xCanPost, true);
  });
});
