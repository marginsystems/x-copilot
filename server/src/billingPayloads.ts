/**
 * Billing view payloads for /api/billing/me and the admin tenant table.
 */
import { isAdminEmail } from "./adminEmails.js";
import {
  CREDIT_EVENT_PATH_SQL,
  dailyActivityUsage,
  getCreditUsage,
  POSTS_READ_EXCLUDING_EXTRA_SQL,
  startOfUtcMonthIso,
} from "./billingQuotas.js";
import {
  ensureUserBillingRow,
  ensureUserTenant,
  type UserBillingRow,
} from "./billingStore.js";
import { getPlatformDb } from "./db.js";
import {
  FREE_PLAN,
  PAID_PLANS,
  PLAN_DAILY_ACTIVITY_EVENTS,
  PLAN_DAILY_SORTIES,
  PLAN_DAILY_SUGGESTS,
  PLAN_PRICE_LABELS,
  derivePlanState,
  isPaidPlanKey,
  type PaidPlanKey,
  type PlanKey,
} from "./plans.js";
import {
  activeManualGrant,
  creditLimitForPlan,
  firstWeekPulseNotice,
  hasLiveStripeSubscription,
  liveSubTakesPrecedence,
  resolvePlan,
} from "./planResolution.js";
import { getSortieUsage } from "./scoutSorties.js";
import {
  resolveStripePriceId,
  stripeSecretPresent,
} from "./stripeConfig.js";

export function billingMePayload(input: {
  userId: string;
  email: string | null;
}): Record<string, unknown> {
  const tenantId = ensureUserTenant(input.userId);
  const row = ensureUserBillingRow(input.userId, tenantId);
  const resolved = resolvePlan(row, input.email);
  const planKey = resolved.planKey;
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
      daily_suggests: PLAN_DAILY_SUGGESTS.free,
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
          daily_suggests: PLAN_DAILY_SUGGESTS[p.key],
          name: p.name,
          blurb: p.blurb,
          image: p.image,
        },
      ]),
    ),
  };
  const status = row.subscriptionStatus;
  const planState = derivePlanState({
    planKey: resolved.reason === "first_week" ? "free" : planKey,
    live: liveSubTakesPrecedence(row),
    status,
    creditsCanUse: usage.canUse,
  });
  const firstWeek =
    resolved.reason === "first_week" && resolved.firstWeekEndsAt
      ? {
          plan_key: planKey,
          ends_at: resolved.firstWeekEndsAt,
          notice: firstWeekPulseNotice(resolved.firstWeekEndsAt),
        }
      : null;

  return {
    plan_key: planKey,
    plan_state: planState,
    first_week_pulse: firstWeek,
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
         u.created_at AS user_created_at,
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
                SUM(${POSTS_READ_EXCLUDING_EXTRA_SQL}) AS posts_read,
                SUM(cost_usd_micros) AS cost_usd_micros
         FROM x_api_usage_events
         WHERE at >= ? AND ${CREDIT_EVENT_PATH_SQL}
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
    user_created_at: string | null;
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
      userCreatedAt: r.user_created_at,
    };
    const planKey = r.user_id
      ? resolvePlan(billing, r.email).planKey
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
