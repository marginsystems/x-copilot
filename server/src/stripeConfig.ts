import { PAID_PLAN_KEYS, type PaidPlanKey } from "./plans.js";

export function isNonProductionEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV?.trim().toLowerCase() !== "production";
}

export function stripeSecretPresent(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.STRIPE_SECRET_KEY?.trim());
}

export function resolveStripePriceId(
  tier: PaidPlanKey,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const baseKey = `STRIPE_PRICE_${tier.toUpperCase()}`;
  const devKey = `${baseKey}_DEV`;
  const preferDev = isNonProductionEnv(env);
  const first = preferDev ? env[devKey]?.trim() : env[baseKey]?.trim();
  const fallback = preferDev ? env[baseKey]?.trim() : null;
  return first || fallback || null;
}

export function planKeyFromStripePriceId(
  priceId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): PaidPlanKey | null {
  const id = typeof priceId === "string" ? priceId.trim() : "";
  if (!id) return null;
  for (const tier of PAID_PLAN_KEYS) {
    const prod = env[`STRIPE_PRICE_${tier.toUpperCase()}`]?.trim();
    const dev = env[`STRIPE_PRICE_${tier.toUpperCase()}_DEV`]?.trim();
    if (id === prod || id === dev) return tier;
  }
  return null;
}

export function priceIdFromSubscription(subscription: {
  items?: { data?: Array<{ price?: string | { id?: string } | null }> };
}): string | null {
  const items = subscription.items?.data;
  if (!items || items.length === 0) return null;
  let firstId: string | null = null;
  for (const item of items) {
    const p = item.price;
    const id =
      typeof p === "string"
        ? p.trim()
        : p && typeof p === "object" && typeof p.id === "string"
          ? p.id.trim()
          : "";
    if (!id) continue;
    if (firstId === null) firstId = id;
    if (planKeyFromStripePriceId(id)) return id;
  }
  return firstId;
}
