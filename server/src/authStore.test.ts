import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformDb, resetPlatformDbForTests, defaultMigrationsDir } from "./db.ts";
import {
  activateSubscription,
  ensureUserTenant,
  getUserBilling,
} from "./billingStore.ts";
import {
  completeOnboarding,
  createSession,
  findOauthAccount,
  getUserById,
  getUserForSessionToken,
  linkOauthToUser,
  revokeSessionToken,
  setUserXUsername,
  upsertOauthUser,
  userNeedsXHandle,
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

  it("requires a handle for Google-only users until they save one", () => {
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
    const updated = completeOnboarding(user.id, agenda, {
      xUsername: "@alice_dev",
    });
    assert.equal(updated?.xUsername, "alice_dev");
    assert.equal(userNeedsXHandle(updated!), false);
  });

  it("overwrites a saved X username from Settings", () => {
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
});
