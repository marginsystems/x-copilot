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
  free: 1_500,
  pulse: 6_000,
  radar: 18_000,
  horizon: 40_000,
};

/** UTC-day Take off cap. Monthly credits still bind; this stops a one-day burn. */
export const PLAN_DAILY_SORTIES: Record<PlanKey, number> = {
  free: 1,
  pulse: 5,
  radar: 10,
  horizon: 25,
};

/**
 * UTC-day cap on delivered post.create events (every public tweet, not
 * desk replies only). Hitting the cap pauses the XAA subscription until
 * the next UTC day.
 */
export const PLAN_DAILY_ACTIVITY_EVENTS: Record<PlanKey, number> = {
  free: 15,
  pulse: 50,
  radar: 120,
  horizon: 250,
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

/** Endless Free tier — no Stripe product, no card. */
export const FREE_PLAN = {
  key: "free" as const,
  name: "Free",
  priceUsd: 0,
  priceLabel: "Free",
  credits: PLAN_CREDIT_LIMITS.free,
  sorties: PLAN_DAILY_SORTIES.free,
  dailyEvents: PLAN_DAILY_ACTIVITY_EVENTS.free,
  blurb: "One Scout takeoff a day and a small watch. No credit card.",
  image: "/favicon.svg",
};

export type PlanState =
  | "free_active"
  | "free_limit_reached"
  | "subscription_active"
  | "past_due";

/** Paid live sub wins; otherwise Free (active or monthly pool empty). */
export function derivePlanState(input: {
  live: boolean;
  status: string | null | undefined;
  creditsCanUse: boolean;
}): PlanState {
  if (input.live && (input.status === "active" || input.status === "trialing")) {
    return "subscription_active";
  }
  if (input.live && (input.status === "past_due" || input.status === "unpaid")) {
    return "past_due";
  }
  return input.creditsCanUse ? "free_active" : "free_limit_reached";
}

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
      "Monthly x-copilot desk from Mergestorm, Inc. 6,000 X post-read credits per UTC month, 5 Scout takeoffs per day, and a 50-post/day watch. Unused credits do not roll over. You review and post on X yourself — no auto-engage.",
    priceUsd: 12,
    priceLabel: PLAN_PRICE_LABELS.pulse,
    credits: PLAN_CREDIT_LIMITS.pulse,
    sorties: PLAN_DAILY_SORTIES.pulse,
    blurb: "A few Scout sessions a week plus a 50-post/day watch for analytics.",
    image: "/images/plan-pulse.png",
  },
  {
    key: "radar",
    name: "Radar",
    stripeProductName: "x-copilot Radar",
    stripeDescription:
      "Monthly x-copilot desk from Mergestorm, Inc. 18,000 X post-read credits per UTC month, 10 Scout takeoffs per day, and a 120-post/day watch. Unused credits do not roll over. You review and post on X yourself — no auto-engage.",
    priceUsd: 36,
    priceLabel: PLAN_PRICE_LABELS.radar,
    credits: PLAN_CREDIT_LIMITS.radar,
    sorties: PLAN_DAILY_SORTIES.radar,
    blurb: "Daily desk and a 120-post/day watch. Scout + analytics share the pool.",
    image: "/images/plan-radar.png",
  },
  {
    key: "horizon",
    name: "Horizon",
    stripeProductName: "x-copilot Horizon",
    stripeDescription:
      "Monthly x-copilot desk from Mergestorm, Inc. 40,000 X post-read credits per UTC month, 25 Scout takeoffs per day, and a 250-post/day watch. Unused credits do not roll over. You review and post on X yourself — no auto-engage.",
    priceUsd: 99,
    priceLabel: PLAN_PRICE_LABELS.horizon,
    credits: PLAN_CREDIT_LIMITS.horizon,
    sorties: PLAN_DAILY_SORTIES.horizon,
    blurb: "Wide field. 25 takeoffs and a 250-post/day watch for heavy desks.",
    image: "/images/plan-horizon.png",
  },
];

export function isPlanKey(value: string): value is PlanKey {
  return (PLAN_KEYS as readonly string[]).includes(value);
}

export function isPaidPlanKey(value: string): value is PaidPlanKey {
  return (PAID_PLAN_KEYS as readonly string[]).includes(value);
}

export function dailyActivityLimit(key: PlanKey): number {
  return PLAN_DAILY_ACTIVITY_EVENTS[key];
}

export function planDisplayName(key: PlanKey): string {
  if (key === "free") return FREE_PLAN.name;
  const paid = PAID_PLANS.find((p) => p.key === key);
  return paid?.name ?? key;
}
