/**
 * Credit plans wrap X post-read usage (UTC month, no rollover, no overage).
 * Paid keys match STRIPE_PRICE_{PULSE,RADAR,HORIZON} env vars.
 */

export const PLAN_KEYS = ["free", "pulse", "radar", "horizon"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export type PaidPlanKey = Exclude<PlanKey, "free">;

export const PAID_PLAN_KEYS: readonly PaidPlanKey[] = [
  "pulse",
  "radar",
  "horizon",
];

export const PLAN_CREDIT_LIMITS: Record<PlanKey, number> = {
  free: 250,
  pulse: 1_500,
  radar: 6_000,
  horizon: 20_000,
};

export const PLAN_PRICE_USD: Record<PaidPlanKey, number> = {
  pulse: 12,
  radar: 36,
  horizon: 99,
};

export const PLAN_PRICE_LABELS: Record<PaidPlanKey, string> = {
  pulse: "$12 / month",
  radar: "$36 / month",
  horizon: "$99 / month",
};

export type PlanCatalogEntry = {
  key: PaidPlanKey;
  name: string;
  priceUsd: number;
  priceLabel: string;
  credits: number;
  blurb: string;
  image: string;
};

export const PAID_PLANS: readonly PlanCatalogEntry[] = [
  {
    key: "pulse",
    name: "Pulse",
    priceUsd: 12,
    priceLabel: PLAN_PRICE_LABELS.pulse,
    credits: PLAN_CREDIT_LIMITS.pulse,
    blurb: "A steady beat. A few Scout sessions a week without watching the meter.",
    image: "/images/plan-pulse.png",
  },
  {
    key: "radar",
    name: "Radar",
    priceUsd: 36,
    priceLabel: PLAN_PRICE_LABELS.radar,
    credits: PLAN_CREDIT_LIMITS.radar,
    blurb: "Daily desk. Sweep more queries, miss a run, still have headroom.",
    image: "/images/plan-radar.png",
  },
  {
    key: "horizon",
    name: "Horizon",
    priceUsd: 99,
    priceLabel: PLAN_PRICE_LABELS.horizon,
    credits: PLAN_CREDIT_LIMITS.horizon,
    blurb: "Wide field. Heavy search days, several agendas, room to iterate.",
    image: "/images/plan-horizon.png",
  },
];

export function isPlanKey(value: string): value is PlanKey {
  return (PLAN_KEYS as readonly string[]).includes(value);
}

export function isPaidPlanKey(value: string): value is PaidPlanKey {
  return (PAID_PLAN_KEYS as readonly string[]).includes(value);
}

export function planDisplayName(key: PlanKey): string {
  if (key === "free") return "Free";
  const paid = PAID_PLANS.find((p) => p.key === key);
  return paid?.name ?? key;
}
