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
import { upsertOauthUser } from "./oauthAccountStore.ts";
import { recordUsageEvent } from "./usageMeter.ts";
import {
  activateSubscription,
  billingMePayload,
  cancelSubscriptionByStripeSubscriptionId,
  ensureUserTenant,
  getUserBilling,
  grantManualPlan,
  listAdminTenantUsage,
  shouldApplyStripeEvent,
} from "./billingStore.ts";
import {
  creditsExhaustedResponse,
  dailyActivityUsage,
  getCreditUsage,
} from "./billingQuotas.ts";
import { upsertOwnPost } from "./ownPostStore.ts";

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
    assert.equal(usage.limit, 1500);
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
      postsRead: 1500,
    });
    const exhausted = creditsExhaustedResponse({
      userId: user.id,
      tenantId,
      email: user.email,
    });
    assert.equal(exhausted?.error, "credits_exhausted");
    assert.equal(exhausted?.limit, 1500);
    assert.match(exhausted?.message ?? "", /1,500 free credits/);
  });

  it("exposes Free in billing/me with free_active state", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-b-me",
      email: "me@example.com",
      emailVerified: true,
    });
    ensureUserTenant(user.id);
    const me = billingMePayload({ userId: user.id, email: user.email });
    assert.equal(me.plan_key, "free");
    assert.equal(me.plan_state, "free_active");
    const plans = me.plans as Record<string, { name: string; credits: number; available: boolean }>;
    assert.equal(plans.free.name, "Free");
    assert.equal(plans.free.credits, 1500);
    assert.equal(plans.free.available, true);
    assert.equal(plans.pulse.name, "Pulse");
  });

  it("marks free_limit_reached when the monthly pool is empty", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-b-empty",
      email: "empty@example.com",
      emailVerified: true,
    });
    const tenantId = ensureUserTenant(user.id);
    recordUsageEvent({
      tenantId,
      path: "/2/tweets/search/recent",
      status: 200,
      postsRead: 1500,
    });
    const me = billingMePayload({ userId: user.id, email: user.email });
    assert.equal(me.plan_state, "free_limit_reached");
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

  it("reports the Horizon pool to admins as a paid plan, not Free", () => {
    process.env.ADMIN_EMAILS = "ops-me@example.com";
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-b-me-admin",
      email: "ops-me@example.com",
      emailVerified: true,
    });
    ensureUserTenant(user.id);
    const me = billingMePayload({ userId: user.id, email: user.email });
    assert.equal(me.plan_key, "horizon");
    assert.equal(me.plan_state, "subscription_active");
    assert.equal(me.operator_allotment, true);
    assert.equal(me.has_stripe_subscription, false);
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

  it("caps free daily watch events at 15", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-watch-1",
      email: "watch@example.com",
      emailVerified: true,
    });
    const tenantId = ensureUserTenant(user.id);
    const empty = dailyActivityUsage(user.id, user.email);
    assert.equal(empty.limit, 15);
    assert.equal(empty.can_watch, true);
    for (let i = 0; i < 15; i += 1) {
      upsertOwnPost({
        parsed: {
          eventUuid: `e-${i}`,
          xUserId: "99",
          postId: `p-${i}`,
          kind: i % 2 === 0 ? "original" : "reply",
          text: "n",
          postedAt: new Date().toISOString(),
          inReplyToId: null,
          inReplyToUserId: null,
          conversationId: null,
          authorUsername: "desk",
          metrics: {},
        },
        userId: user.id,
        tenantId,
      });
    }
    const full = dailyActivityUsage(user.id, user.email);
    assert.equal(full.used, 15);
    assert.equal(full.can_watch, false);
  });

  it("applies a complimentary Pulse grant without a Stripe sub", () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "xid-grant",
      username: "willizuchukwu",
      email: "will@example.com",
      emailVerified: true,
    });
    ensureUserTenant(user.id);
    grantManualPlan({
      userId: user.id,
      planKey: "pulse",
      grantedBy: "margin707@gmail.com",
    });
    const me = billingMePayload({ userId: user.id, email: user.email });
    assert.equal(me.plan_key, "pulse");
    assert.equal(me.plan_state, "subscription_active");
    assert.equal(me.has_stripe_subscription, false);
    const grant = me.manual_grant as { plan_key?: string; notice?: string };
    assert.equal(grant.plan_key, "pulse");
    assert.match(grant.notice ?? "", /manually upgraded to Pulse/);
    const tenants = listAdminTenantUsage();
    const row = tenants.find((t) => t.userId === user.id);
    assert.equal(row?.manualGrant, true);
    assert.equal(row?.grantPlanKey, "pulse");
    assert.equal(row?.planKey, "pulse");
    assert.equal(getCreditUsage(row!.tenantId, "pulse").limit, 6000);
  });

  it("lets a live Stripe sub win over a leftover grant", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-grant-stripe",
      email: "paid@example.com",
      emailVerified: true,
    });
    ensureUserTenant(user.id);
    grantManualPlan({
      userId: user.id,
      planKey: "pulse",
      grantedBy: "ops@example.com",
    });
    activateSubscription({
      userId: user.id,
      planKey: "radar",
      stripeCustomerId: "cus_g",
      stripeSubscriptionId: "sub_g",
      subscriptionStatus: "active",
      currentPeriodEnd: new Date().toISOString(),
      cancelAtPeriodEnd: false,
      stripeEventCreated: 1,
    });
    const me = billingMePayload({ userId: user.id, email: user.email });
    assert.equal(me.plan_key, "radar");
    assert.equal(me.manual_grant, null);
  });

  it("keeps the grant live when the Stripe sub is incomplete", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-grant-incomplete",
      email: "incomplete-grant@example.com",
      emailVerified: true,
    });
    ensureUserTenant(user.id);
    grantManualPlan({
      userId: user.id,
      planKey: "pulse",
      grantedBy: "ops@example.com",
    });
    activateSubscription({
      userId: user.id,
      planKey: "pulse",
      stripeCustomerId: "cus_gi",
      stripeSubscriptionId: "sub_gi",
      subscriptionStatus: "incomplete",
      currentPeriodEnd: new Date().toISOString(),
      cancelAtPeriodEnd: false,
      stripeEventCreated: 1,
    });
    const me = billingMePayload({ userId: user.id, email: user.email });
    assert.equal(me.plan_key, "pulse");
    assert.equal(me.plan_state, "subscription_active");
    const grant = me.manual_grant as { plan_key?: string };
    assert.equal(grant?.plan_key, "pulse");
    const tenants = listAdminTenantUsage();
    assert.equal(tenants.find((t) => t.userId === user.id)?.manualGrant, true);
  });

  it("clears a grant back to Free", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-grant-clear",
      email: "clear@example.com",
      emailVerified: true,
    });
    ensureUserTenant(user.id);
    grantManualPlan({
      userId: user.id,
      planKey: "horizon",
      grantedBy: "ops@example.com",
    });
    grantManualPlan({
      userId: user.id,
      planKey: "free",
      grantedBy: "ops@example.com",
    });
    const me = billingMePayload({ userId: user.id, email: user.email });
    assert.equal(me.plan_key, "free");
    assert.equal(me.manual_grant, null);
  });

  it("applies equal-or-newer Stripe watermarks", () => {
    assert.equal(shouldApplyStripeEvent(0, 1), true);
    assert.equal(shouldApplyStripeEvent(10, 10), true);
    assert.equal(shouldApplyStripeEvent(10, 9), false);
  });
});
