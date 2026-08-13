/**
 * Tenant + Stripe billing rows. Credits = X post reads this UTC month.
 */
import { randomUUID } from "node:crypto";
import { isAdminEmail } from "./adminEmails.js";
import { getPlatformDb } from "./db.js";
import {
  PAID_PLANS,
  PLAN_CREDIT_LIMITS,
  PLAN_PRICE_LABELS,
  isPaidPlanKey,
  type PaidPlanKey,
  type PlanKey,
} from "./plans.js";
import {
  resolveStripePriceId,
  stripeSecretPresent,
} from "./stripeConfig.js";

export type UserBillingRow = {
  userId: string;
  tenantId: string;
  planKey: PlanKey;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeLastEventCreated: number;
  updatedAt: string;
};

const LIVE_SUB_STATUSES = new Set(["active", "trialing", "past_due", "unpaid"]);
const NON_LIVE_SUB_STATUSES = new Set(["canceled", "incomplete_expired"]);

function nowIso(): string {
  return new Date().toISOString();
}

export function startOfUtcMonthIso(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
}

function tenantSlugForUser(userId: string, email: string | null): string {
  const local = (email?.split("@")[0] || "desk")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const base = local || "desk";
  return `${base}-${userId.replace(/-/g, "").slice(0, 8)}`;
}

type UserTenantRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  tenant_id: string | null;
};

export function ensureUserTenant(userId: string): string {
  const database = getPlatformDb();
  const user = database
    .prepare(`SELECT id, email, display_name, tenant_id FROM users WHERE id = ?`)
    .get(userId) as UserTenantRow | undefined;
  if (!user) throw new Error("user_missing");
  if (user.tenant_id) {
    ensureUserBillingRow(userId, user.tenant_id);
    return user.tenant_id;
  }

  const tenantId = randomUUID();
  const slug = tenantSlugForUser(userId, user.email);
  const name = user.display_name?.trim() || user.email || "Desk";
  const at = nowIso();
  const tx = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO tenants (id, slug, name, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run(tenantId, slug, name, at);
    database
      .prepare(`UPDATE users SET tenant_id = ? WHERE id = ?`)
      .run(tenantId, userId);
    database
      .prepare(
        `INSERT INTO user_billing
           (user_id, tenant_id, plan_key, cancel_at_period_end, stripe_last_event_created, updated_at)
         VALUES (?, ?, 'free', 0, 0, ?)`,
      )
      .run(userId, tenantId, at);
  });
  tx();
  return tenantId;
}

export function ensureUserBillingRow(
  userId: string,
  tenantId?: string,
): UserBillingRow {
  const database = getPlatformDb();
  const existing = getUserBilling(userId);
  if (existing) return existing;
  const tid = tenantId ?? ensureUserTenant(userId);
  const at = nowIso();
  database
    .prepare(
      `INSERT INTO user_billing
         (user_id, tenant_id, plan_key, cancel_at_period_end, stripe_last_event_created, updated_at)
       VALUES (?, ?, 'free', 0, 0, ?)
       ON CONFLICT(user_id) DO NOTHING`,
    )
    .run(userId, tid, at);
  const row = getUserBilling(userId);
  if (!row) throw new Error("billing_row_missing");
  return row;
}

function mapBilling(row: {
  user_id: string;
  tenant_id: string;
  plan_key: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: number;
  stripe_last_event_created: number;
  updated_at: string;
}): UserBillingRow {
  const planKey: PlanKey = isPaidPlanKey(row.plan_key) ? row.plan_key : "free";
  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    planKey,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    subscriptionStatus: row.subscription_status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    stripeLastEventCreated: Number(row.stripe_last_event_created) || 0,
    updatedAt: row.updated_at,
  };
}

export function getUserBilling(userId: string): UserBillingRow | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT user_id, tenant_id, plan_key, stripe_customer_id, stripe_subscription_id,
              subscription_status, current_period_end, cancel_at_period_end,
              stripe_last_event_created, updated_at
       FROM user_billing WHERE user_id = ?`,
    )
    .get(userId) as
    | {
        user_id: string;
        tenant_id: string;
        plan_key: string;
        stripe_customer_id: string | null;
        stripe_subscription_id: string | null;
        subscription_status: string | null;
        current_period_end: string | null;
        cancel_at_period_end: number;
        stripe_last_event_created: number;
        updated_at: string;
      }
    | undefined;
  return row ? mapBilling(row) : null;
}

export function getUserBillingBySubscriptionId(
  subscriptionId: string,
): UserBillingRow | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT user_id, tenant_id, plan_key, stripe_customer_id, stripe_subscription_id,
              subscription_status, current_period_end, cancel_at_period_end,
              stripe_last_event_created, updated_at
       FROM user_billing WHERE stripe_subscription_id = ?`,
    )
    .get(subscriptionId) as
    | {
        user_id: string;
        tenant_id: string;
        plan_key: string;
        stripe_customer_id: string | null;
        stripe_subscription_id: string | null;
        subscription_status: string | null;
        current_period_end: string | null;
        cancel_at_period_end: number;
        stripe_last_event_created: number;
        updated_at: string;
      }
    | undefined;
  return row ? mapBilling(row) : null;
}

export function persistStripeCustomerId(
  userId: string,
  customerId: string,
): void {
  getPlatformDb()
    .prepare(
      `UPDATE user_billing SET stripe_customer_id = ?, updated_at = ? WHERE user_id = ?`,
    )
    .run(customerId, nowIso(), userId);
}

export function shouldApplyStripeEvent(
  storedCreated: number | null | undefined,
  eventCreated: number,
): boolean {
  if (storedCreated == null || storedCreated === 0) return true;
  return eventCreated >= storedCreated;
}

function nextWatermark(
  storedCreated: number | null | undefined,
  eventCreated: number | undefined,
): number {
  const incoming = eventCreated ?? 0;
  const stored = storedCreated ?? 0;
  return Math.max(stored, incoming);
}

export function activateSubscription(input: {
  userId: string;
  planKey: PaidPlanKey;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscriptionStatus: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeEventCreated?: number;
}): void {
  const row = ensureUserBillingRow(input.userId);
  if (!shouldApplyStripeEvent(row.stripeLastEventCreated, input.stripeEventCreated ?? 0)) {
    return;
  }
  const watermark = nextWatermark(
    row.stripeLastEventCreated,
    input.stripeEventCreated,
  );
  getPlatformDb()
    .prepare(
      `UPDATE user_billing SET
         plan_key = ?,
         stripe_customer_id = ?,
         stripe_subscription_id = ?,
         subscription_status = ?,
         current_period_end = ?,
         cancel_at_period_end = ?,
         stripe_last_event_created = ?,
         updated_at = ?
       WHERE user_id = ?`,
    )
    .run(
      input.planKey,
      input.stripeCustomerId,
      input.stripeSubscriptionId,
      input.subscriptionStatus,
      input.currentPeriodEnd,
      input.cancelAtPeriodEnd ? 1 : 0,
      watermark,
      nowIso(),
      input.userId,
    );
}

export function updateSubscriptionFromStripe(input: {
  stripeSubscriptionId: string;
  userId?: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  planKey?: PaidPlanKey | null;
  stripeEventCreated?: number;
}): void {
  const row =
    getUserBillingBySubscriptionId(input.stripeSubscriptionId) ??
    (input.userId ? getUserBilling(input.userId) : null);
  if (!row) return;
  if (!shouldApplyStripeEvent(row.stripeLastEventCreated, input.stripeEventCreated ?? 0)) {
    return;
  }
  const watermark = nextWatermark(
    row.stripeLastEventCreated,
    input.stripeEventCreated,
  );
  const planKey = input.planKey ?? row.planKey;
  getPlatformDb()
    .prepare(
      `UPDATE user_billing SET
         plan_key = ?,
         subscription_status = ?,
         current_period_end = ?,
         cancel_at_period_end = ?,
         stripe_last_event_created = ?,
         updated_at = ?
       WHERE user_id = ?`,
    )
    .run(
      planKey,
      input.status,
      input.currentPeriodEnd,
      input.cancelAtPeriodEnd ? 1 : 0,
      watermark,
      nowIso(),
      row.userId,
    );
}

export function cancelSubscriptionByStripeSubscriptionId(
  subscriptionId: string,
  stripeEventCreated?: number,
): void {
  const row = getUserBillingBySubscriptionId(subscriptionId);
  if (!row) return;
  if (!shouldApplyStripeEvent(row.stripeLastEventCreated, stripeEventCreated ?? 0)) {
    return;
  }
  const watermark = nextWatermark(row.stripeLastEventCreated, stripeEventCreated);
  getPlatformDb()
    .prepare(
      `UPDATE user_billing SET
         plan_key = 'free',
         stripe_subscription_id = NULL,
         subscription_status = 'canceled',
         cancel_at_period_end = 0,
         stripe_last_event_created = ?,
         updated_at = ?
       WHERE user_id = ?`,
    )
    .run(watermark, nowIso(), row.userId);
}

export function countPostsReadThisUtcMonth(tenantId: string): number {
  const since = startOfUtcMonthIso();
  const row = getPlatformDb()
    .prepare(
      `SELECT COALESCE(SUM(posts_read), 0) AS n
       FROM x_api_usage_events
       WHERE tenant_id = ? AND at >= ? AND path LIKE '%/tweets%'`,
    )
    .get(tenantId, since) as { n: number };
  return Number(row.n) || 0;
}

export function hasLiveStripeSubscription(row: UserBillingRow): boolean {
  const sub = row.stripeSubscriptionId?.trim();
  if (!sub) return false;
  const status = row.subscriptionStatus?.trim() || null;
  if (status && NON_LIVE_SUB_STATUSES.has(status)) return false;
  return true;
}

export function hasPaidBillingHistory(row: UserBillingRow): boolean {
  return Boolean(row.stripeCustomerId?.trim() || row.stripeSubscriptionId?.trim());
}

export function effectivePlanKey(
  row: UserBillingRow,
  email: string | null | undefined,
): PlanKey {
  const status = row.subscriptionStatus?.trim() || null;
  if (
    hasLiveStripeSubscription(row) &&
    isPaidPlanKey(row.planKey) &&
    (!status || LIVE_SUB_STATUSES.has(status))
  ) {
    return row.planKey;
  }
  if (isAdminEmail(email)) return "horizon";
  return "free";
}

export function creditLimitForPlan(plan: PlanKey): number {
  return PLAN_CREDIT_LIMITS[plan];
}

export type CreditUsage = {
  planKey: PlanKey;
  used: number;
  limit: number;
  remaining: number;
  canUse: boolean;
};

export function getCreditUsage(
  tenantId: string,
  planKey: PlanKey,
): CreditUsage {
  const used = countPostsReadThisUtcMonth(tenantId);
  const limit = creditLimitForPlan(planKey);
  const remaining = Math.max(0, limit - used);
  return {
    planKey,
    used,
    limit,
    remaining,
    canUse: remaining > 0,
  };
}

/** 402 body when the monthly pool is empty. null = allow Scout. */
export function creditsExhaustedResponse(input: {
  userId?: string;
  tenantId: string;
  email?: string | null;
}): {
  error: "credits_exhausted";
  message: string;
  used: number;
  limit: number;
  planKey: PlanKey;
} | null {
  if (!input.userId) return null;
  const row = ensureUserBillingRow(input.userId, input.tenantId);
  const planKey = effectivePlanKey(row, input.email);
  const usage = getCreditUsage(input.tenantId, planKey);
  if (usage.canUse) return null;
  return {
    error: "credits_exhausted",
    message: `This month's ${usage.limit.toLocaleString()} credits are used. Upgrade on Usage & Billing, or wait until the next UTC month.`,
    used: usage.used,
    limit: usage.limit,
    planKey,
  };
}

export function billingMePayload(input: {
  userId: string;
  email: string | null;
}): Record<string, unknown> {
  const tenantId = ensureUserTenant(input.userId);
  const row = ensureUserBillingRow(input.userId, tenantId);
  const planKey = effectivePlanKey(row, input.email);
  const usage = getCreditUsage(tenantId, planKey);
  const secretOk = stripeSecretPresent();
  const live = hasLiveStripeSubscription(row);
  const plans = Object.fromEntries(
    PAID_PLANS.map((p) => [
      p.key,
      {
        available: secretOk && Boolean(resolveStripePriceId(p.key)),
        price_label: PLAN_PRICE_LABELS[p.key],
        credits: p.credits,
        name: p.name,
        blurb: p.blurb,
        image: p.image,
      },
    ]),
  );
  const status = row.subscriptionStatus;
  const planState =
    live && (status === "active" || status === "trialing")
      ? "subscription_active"
      : live && (status === "past_due" || status === "unpaid")
        ? "past_due"
        : "free";

  return {
    plan_key: planKey,
    plan_state: planState,
    subscription_status: status,
    has_stripe_customer: Boolean(row.stripeCustomerId),
    has_stripe_subscription: live,
    subscription: {
      status,
      current_period_end: row.currentPeriodEnd,
      cancel_at_period_end: row.cancelAtPeriodEnd,
    },
    credits: {
      used: usage.used,
      limit: usage.limit,
      remaining: usage.remaining,
      can_use: usage.canUse,
    },
    stripe_configured: secretOk,
    plans,
    operator_allotment: isAdminEmail(input.email) && planKey === "horizon" && !live,
  };
}

export type AdminTenantUsage = {
  tenantId: string;
  slug: string;
  name: string;
  createdAt: string;
  userId: string | null;
  email: string | null;
  planKey: PlanKey;
  subscriptionStatus: string | null;
  postsRead: number;
  estimatedUsd: number;
  creditLimit: number;
};

export function listAdminTenantUsage(): AdminTenantUsage[] {
  const since = startOfUtcMonthIso();
  const rows = getPlatformDb()
    .prepare(
      `SELECT
         t.id AS tenant_id,
         t.slug,
         t.name,
         t.created_at,
         u.id AS user_id,
         u.email,
         b.plan_key,
         b.subscription_status,
         b.stripe_subscription_id,
         COALESCE(agg.posts_read, 0) AS posts_read,
         COALESCE(agg.cost_usd_micros, 0) AS cost_usd_micros
       FROM tenants t
       LEFT JOIN users u ON u.tenant_id = t.id
       LEFT JOIN user_billing b ON b.user_id = u.id
       LEFT JOIN (
         SELECT tenant_id,
                SUM(posts_read) AS posts_read,
                SUM(cost_usd_micros) AS cost_usd_micros
         FROM x_api_usage_events
         WHERE at >= ? AND path LIKE '%/tweets%'
         GROUP BY tenant_id
       ) agg ON agg.tenant_id = t.id
       ORDER BY posts_read DESC, t.created_at ASC`,
    )
    .all(since) as Array<{
    tenant_id: string;
    slug: string;
    name: string;
    created_at: string;
    user_id: string | null;
    email: string | null;
    plan_key: string | null;
    subscription_status: string | null;
    stripe_subscription_id: string | null;
    posts_read: number;
    cost_usd_micros: number;
  }>;

  return rows.map((r) => {
    const billing: UserBillingRow = {
      userId: r.user_id ?? "",
      tenantId: r.tenant_id,
      planKey: isPaidPlanKey(r.plan_key ?? "") ? (r.plan_key as PaidPlanKey) : "free",
      stripeCustomerId: null,
      stripeSubscriptionId: r.stripe_subscription_id,
      subscriptionStatus: r.subscription_status,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      stripeLastEventCreated: 0,
      updatedAt: r.created_at,
    };
    const planKey = r.user_id
      ? effectivePlanKey(billing, r.email)
      : "free";
    const postsRead = Number(r.posts_read) || 0;
    return {
      tenantId: r.tenant_id,
      slug: r.slug,
      name: r.name,
      createdAt: r.created_at,
      userId: r.user_id,
      email: r.email,
      planKey,
      subscriptionStatus: r.subscription_status,
      postsRead,
      estimatedUsd:
        Math.round(((Number(r.cost_usd_micros) || 0) / 1_000_000) * 1_000_000) /
        1_000_000,
      creditLimit: creditLimitForPlan(planKey),
    };
  });
}
