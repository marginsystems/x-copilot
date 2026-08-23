/**
 * Tenant + Stripe billing rows. Credits = X post reads this UTC month.
 */
import { randomUUID } from "node:crypto";
import { getPlatformDb } from "./db.js";
import {
  isPaidPlanKey,
  type PaidPlanKey,
  type PlanKey,
} from "./plans.js";

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

function nowIso(): string {
  return new Date().toISOString();
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
