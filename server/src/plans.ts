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

/** UTC-day Take off cap. Monthly credits still bind; this stops a one-day burn. */
export const PLAN_DAILY_SORTIES: Record<PlanKey, number> = {
  free: 1,
  pulse: 4,
  radar: 8,
  horizon: 20,
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
  stripeProductName: string;
  stripeDescription: string;
  priceUsd: number;
  priceLabel: string;
  credits: number;
  sorties: number;
  blurb: string;
  image: string;
};

export const PAID_PLANS: readonly PlanCatalogEntry[] = [
  {
    key: "pulse",
    name: "Pulse",
    stripeProductName: "x-copilot Pulse",
    stripeDescription:
      "Monthly x-copilot desk from Mergestorm, Inc. 1,500 X post-read credits per UTC month and 4 Scout takeoffs per day. Unused credits do not roll over. You review and post on X yourself — no auto-engage.",
    priceUsd: 12,
    priceLabel: PLAN_PRICE_LABELS.pulse,
    credits: PLAN_CREDIT_LIMITS.pulse,
    sorties: PLAN_DAILY_SORTIES.pulse,
    blurb: "A few Scout sessions a week. 1,500 post reads and 4 takeoffs a day.",
    image: "/images/plan-pulse.png",
  },
  {
    key: "radar",
    name: "Radar",
    stripeProductName: "x-copilot Radar",
    stripeDescription:
      "Monthly x-copilot desk from Mergestorm, Inc. 6,000 X post-read credits per UTC month and 8 Scout takeoffs per day. Unused credits do not roll over. You review and post on X yourself — no auto-engage.",
    priceUsd: 36,
    priceLabel: PLAN_PRICE_LABELS.radar,
    credits: PLAN_CREDIT_LIMITS.radar,
    sorties: PLAN_DAILY_SORTIES.radar,
    blurb: "Daily desk. 6,000 post reads and 8 takeoffs a day, with room to miss a run.",
    image: "/images/plan-radar.png",
  },
  {
    key: "horizon",
    name: "Horizon",
    stripeProductName: "x-copilot Horizon",
    stripeDescription:
      "Monthly x-copilot desk from Mergestorm, Inc. 20,000 X post-read credits per UTC month and 20 Scout takeoffs per day. Unused credits do not roll over. You review and post on X yourself — no auto-engage.",
    priceUsd: 99,
    priceLabel: PLAN_PRICE_LABELS.horizon,
    credits: PLAN_CREDIT_LIMITS.horizon,
    sorties: PLAN_DAILY_SORTIES.horizon,
    blurb: "Wide field. 20,000 post reads and 20 takeoffs a day for heavy search days.",
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
