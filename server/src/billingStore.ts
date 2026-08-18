/**
 * Tenant + Stripe billing rows. Credits = X post reads this UTC month.
 */
import { randomUUID } from "node:crypto";
import { isAdminEmail } from "./adminEmails.js";
import { getPlatformDb } from "./db.js";
import {
  FREE_PLAN,
  PAID_PLANS,
  PLAN_CREDIT_LIMITS,
  PLAN_DAILY_ACTIVITY_EVENTS,
  PLAN_DAILY_SORTIES,
  PLAN_PRICE_LABELS,
  derivePlanState,
  isPaidPlanKey,
  planDisplayName,
  type PaidPlanKey,
  type PlanKey,
} from "./plans.js";
import { countOwnPostsSince, startOfUtcDayIso } from "./ownPostStore.js";
import { getSortieUsage } from "./scoutSorties.js";
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
  grantPlanKey: PaidPlanKey | null;
  grantCreatedAt: string | null;
  grantCreatedBy: string | null;
};

const BILLING_SELECT = `user_id, tenant_id, plan_key, stripe_customer_id, stripe_subscription_id,
              subscription_status, current_period_end, cancel_at_period_end,
              stripe_last_event_created, updated_at,
              grant_plan_key, grant_created_at, grant_created_by`;

type BillingSqlRow = {
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
  grant_plan_key: string | null;
  grant_created_at: string | null;
  grant_created_by: string | null;
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

function mapBilling(row: BillingSqlRow): UserBillingRow {
  const planKey: PlanKey = isPaidPlanKey(row.plan_key) ? row.plan_key : "free";
  const grantPlanKey = isPaidPlanKey(row.grant_plan_key ?? "")
    ? (row.grant_plan_key as PaidPlanKey)
    : null;
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
    grantPlanKey,
    grantCreatedAt: row.grant_created_at,
    grantCreatedBy: row.grant_created_by,
  };
}

export function getUserBilling(userId: string): UserBillingRow | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT ${BILLING_SELECT}
       FROM user_billing WHERE user_id = ?`,
    )
    .get(userId) as BillingSqlRow | undefined;
  return row ? mapBilling(row) : null;
}

export function getUserBillingBySubscriptionId(
  subscriptionId: string,
): UserBillingRow | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT ${BILLING_SELECT}
       FROM user_billing WHERE stripe_subscription_id = ?`,
    )
    .get(subscriptionId) as BillingSqlRow | undefined;
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
  stripeCustomerId?: string | null;
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
         stripe_subscription_id = ?,
         stripe_customer_id = COALESCE(?, stripe_customer_id),
         subscription_status = ?,
         current_period_end = ?,
         cancel_at_period_end = ?,
         stripe_last_event_created = ?,
         updated_at = ?
       WHERE user_id = ?`,
    )
    .run(
      planKey,
      input.stripeSubscriptionId,
      input.stripeCustomerId ?? null,
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

/** True when the live Stripe sub actually resolves to the effective plan. */
export function liveSubTakesPrecedence(row: UserBillingRow): boolean {
  const status = row.subscriptionStatus?.trim() || null;
  return (
    hasLiveStripeSubscription(row) &&
    isPaidPlanKey(row.planKey) &&
    (!status || LIVE_SUB_STATUSES.has(status))
  );
}

export function effectivePlanKey(
  row: UserBillingRow,
  email: string | null | undefined,
): PlanKey {
  if (liveSubTakesPrecedence(row)) return row.planKey;
  if (isAdminEmail(email)) return "horizon";
  if (row.grantPlanKey && isPaidPlanKey(row.grantPlanKey)) return row.grantPlanKey;
  return "free";
}

export function manualGrantNotice(planKey: PaidPlanKey): string {
  return `This account was manually upgraded to ${planDisplayName(planKey)} without a Stripe subscription.`;
}

export function grantManualPlan(opts: {
  userId: string;
  planKey: PaidPlanKey | "free";
  grantedBy: string;
}): UserBillingRow {
  ensureUserBillingRow(opts.userId);
  const at = nowIso();
  const by = opts.grantedBy.trim().toLowerCase();
  if (opts.planKey === "free") {
    getPlatformDb()
      .prepare(
        `UPDATE user_billing SET
           grant_plan_key = NULL,
           grant_created_at = NULL,
           grant_created_by = NULL,
           updated_at = ?
         WHERE user_id = ?`,
      )
      .run(at, opts.userId);
  } else {
    getPlatformDb()
      .prepare(
        `UPDATE user_billing SET
           grant_plan_key = ?,
           grant_created_at = ?,
           grant_created_by = ?,
           updated_at = ?
         WHERE user_id = ?`,
      )
      .run(opts.planKey, at, by, at, opts.userId);
  }
  const row = getUserBilling(opts.userId);
  if (!row) throw new Error("billing_row_missing");
  return row;
}

export function activeManualGrant(
  row: UserBillingRow,
  email: string | null | undefined,
): {
  plan_key: PaidPlanKey;
  created_at: string | null;
  created_by: string | null;
  notice: string;
} | null {
  if (!row.grantPlanKey) return null;
  if (liveSubTakesPrecedence(row)) return null;
  if (isAdminEmail(email)) return null;
  return {
    plan_key: row.grantPlanKey,
    created_at: row.grantCreatedAt,
    created_by: row.grantCreatedBy,
    notice: manualGrantNotice(row.grantPlanKey),
  };
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

export function dailyActivityUsage(
  userId: string,
  email: string | null | undefined,
): {
  used: number;
  limit: number;
  remaining: number;
  can_watch: boolean;
  planKey: PlanKey;
} {
  const tenantId = ensureUserTenant(userId);
  const row = ensureUserBillingRow(userId, tenantId);
  const planKey = effectivePlanKey(row, email);
  const limit = PLAN_DAILY_ACTIVITY_EVENTS[planKey];
  const used = countOwnPostsSince(userId, startOfUtcDayIso());
  const remaining = Math.max(0, limit - used);
  return {
    used,
    limit,
    remaining,
    can_watch: remaining > 0,
    planKey,
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
  const pool =
    planKey === "free"
      ? `${usage.limit.toLocaleString()} free credits`
      : `${usage.limit.toLocaleString()} credits`;
  return {
    error: "credits_exhausted",
    message: `You've used this month's ${pool}. Upgrade on Usage & Billing, or wait until the next UTC month.`,
    used: usage.used,
    limit: usage.limit,
    planKey,
  };
}

/** 429 body when today's Take offs are used. null = allow. */
export function sortiesExhaustedResponse(input: {
  userId?: string;
  tenantId: string;
  email?: string | null;
}): {
  error: "scout_daily_limit";
  message: string;
  used: number;
  limit: number;
  planKey: PlanKey;
} | null {
  if (!input.userId) return null;
  const row = ensureUserBillingRow(input.userId, input.tenantId);
  const planKey = effectivePlanKey(row, input.email);
  const usage = getSortieUsage(input.tenantId, planKey);
  if (usage.canFly) return null;
  return {
    error: "scout_daily_limit",
    message: `Grounded — ${usage.limit} sortie${usage.limit === 1 ? "" : "s"} used today. Next takeoff after 00:00 UTC.`,
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
  const sorties = getSortieUsage(tenantId, planKey);
  const secretOk = stripeSecretPresent();
  const live = hasLiveStripeSubscription(row);
  const plans = {
    free: {
      available: true,
      price_label: FREE_PLAN.priceLabel,
      credits: FREE_PLAN.credits,
      sorties: FREE_PLAN.sorties,
      daily_events: FREE_PLAN.dailyEvents,
      daily_sorties: FREE_PLAN.sorties,
      name: FREE_PLAN.name,
      blurb: FREE_PLAN.blurb,
      image: FREE_PLAN.image,
    },
    ...Object.fromEntries(
      PAID_PLANS.map((p) => [
        p.key,
        {
          available: secretOk && Boolean(resolveStripePriceId(p.key)),
          price_label: PLAN_PRICE_LABELS[p.key],
          credits: p.credits,
          sorties: p.sorties,
          daily_events: PLAN_DAILY_ACTIVITY_EVENTS[p.key],
          daily_sorties: PLAN_DAILY_SORTIES[p.key],
          name: p.name,
          blurb: p.blurb,
          image: p.image,
        },
      ]),
    ),
  };
  const status = row.subscriptionStatus;
  const planState = derivePlanState({
    planKey,
    live,
    status,
    creditsCanUse: usage.canUse,
  });

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
    sorties: {
      used: sorties.used,
      limit: sorties.limit,
      remaining: sorties.remaining,
      can_fly: sorties.canFly,
    },
    activity: dailyActivityUsage(input.userId, input.email),
    stripe_configured: secretOk,
    plans,
    operator_allotment: isAdminEmail(input.email) && planKey === "horizon" && !live,
    manual_grant: activeManualGrant(row, input.email),
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
  grantPlanKey: PaidPlanKey | null;
  manualGrant: boolean;
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
         b.grant_plan_key,
         b.grant_created_at,
         b.grant_created_by,
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
    grant_plan_key: string | null;
    grant_created_at: string | null;
    grant_created_by: string | null;
    posts_read: number;
    cost_usd_micros: number;
  }>;

  return rows.map((r) => {
    const grantPlanKey = isPaidPlanKey(r.grant_plan_key ?? "")
      ? (r.grant_plan_key as PaidPlanKey)
      : null;
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
      grantPlanKey,
      grantCreatedAt: r.grant_created_at,
      grantCreatedBy: r.grant_created_by,
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
      grantPlanKey,
      manualGrant: Boolean(activeManualGrant(billing, r.email)),
      postsRead,
      estimatedUsd:
        Math.round(((Number(r.cost_usd_micros) || 0) / 1_000_000) * 1_000_000) /
        1_000_000,
      creditLimit: creditLimitForPlan(planKey),
    };
  });
}
