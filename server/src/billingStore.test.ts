import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { upsertOauthUser } from "./authStore.ts";
import { recordUsageEvent } from "./usageMeter.ts";
import {
  activateSubscription,
  cancelSubscriptionByStripeSubscriptionId,
  creditsExhaustedResponse,
  ensureUserTenant,
  getCreditUsage,
  getUserBilling,
  shouldApplyStripeEvent,
} from "./billingStore.ts";

describe("billingStore", () => {
  let dir: string;
  const prevAdmin = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-bill-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    delete process.env.ADMIN_EMAILS;
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    if (prevAdmin === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = prevAdmin;
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a tenant + free billing row per user", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-b1",
      email: "alice@example.com",
      emailVerified: true,
      displayName: "Alice",
    });
    const tenantId = ensureUserTenant(user.id);
    const billing = getUserBilling(user.id);
    assert.ok(tenantId);
    assert.equal(billing?.planKey, "free");
    assert.equal(billing?.tenantId, tenantId);
    const usage = getCreditUsage(tenantId, "free");
    assert.equal(usage.limit, 250);
    assert.equal(usage.used, 0);
    assert.equal(usage.canUse, true);
  });

  it("402s when the free pool is empty", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-b2",
      email: "bob@example.com",
      emailVerified: true,
    });
    const tenantId = ensureUserTenant(user.id);
    recordUsageEvent({
      tenantId,
      path: "/2/tweets/search/recent",
      status: 200,
      postsRead: 250,
    });
    const exhausted = creditsExhaustedResponse({
      userId: user.id,
      tenantId,
      email: user.email,
    });
    assert.equal(exhausted?.error, "credits_exhausted");
    assert.equal(exhausted?.limit, 250);
  });

  it("gives ADMIN_EMAILS the Horizon pool until they subscribe", () => {
    process.env.ADMIN_EMAILS = "ops@example.com";
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-b3",
      email: "ops@example.com",
      emailVerified: true,
    });
    const tenantId = ensureUserTenant(user.id);
    recordUsageEvent({
      tenantId,
      path: "/2/tweets/search/recent",
      status: 200,
      postsRead: 250,
    });
    const exhausted = creditsExhaustedResponse({
      userId: user.id,
      tenantId,
      email: user.email,
    });
    assert.equal(exhausted, null);
  });

  it("activates a paid plan and ignores stale webhook events", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-b4",
      email: "cara@example.com",
      emailVerified: true,
    });
    ensureUserTenant(user.id);
    activateSubscription({
      userId: user.id,
      planKey: "radar",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      subscriptionStatus: "active",
      currentPeriodEnd: new Date().toISOString(),
      cancelAtPeriodEnd: false,
      stripeEventCreated: 200,
    });
    assert.equal(getUserBilling(user.id)?.planKey, "radar");
    activateSubscription({
      userId: user.id,
      planKey: "pulse",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      subscriptionStatus: "active",
      currentPeriodEnd: new Date().toISOString(),
      cancelAtPeriodEnd: false,
      stripeEventCreated: 100,
    });
    assert.equal(getUserBilling(user.id)?.planKey, "radar");
    cancelSubscriptionByStripeSubscriptionId("sub_1", 300);
    assert.equal(getUserBilling(user.id)?.planKey, "free");
  });

  it("applies equal-or-newer Stripe watermarks", () => {
    assert.equal(shouldApplyStripeEvent(0, 1), true);
    assert.equal(shouldApplyStripeEvent(10, 10), true);
    assert.equal(shouldApplyStripeEvent(10, 9), false);
  });
});
