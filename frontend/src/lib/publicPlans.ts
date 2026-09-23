/** Public plan cards. Numbers match server/src/plans.ts and index.html JSON-LD. */

export type PublicPlanKey = "free" | "pulse" | "radar" | "horizon";

export type PublicPlan = {
  key: PublicPlanKey;
  name: string;
  priceLabel: string;
  priceUsd: number;
  credits: number;
  sorties: number;
  watch: number;
  suggests: number;
  blurb: string;
  image: string;
};

export const PUBLIC_PLANS: readonly PublicPlan[] = [
  {
    key: "free",
    name: "Free",
    priceLabel: "Free",
    priceUsd: 0,
    credits: 1_500,
    sorties: 1,
    watch: 15,
    suggests: 10,
    blurb: "One Scout takeoff a day and a small watch. No credit card.",
    image: "/favicon.svg",
  },
  {
    key: "pulse",
    name: "Pulse",
    priceLabel: "$12 / month",
    priceUsd: 12,
    credits: 6_000,
    sorties: 5,
    watch: 50,
    suggests: 20,
    blurb: "A few Scout sessions a week plus a 50-post/day watch for analytics.",
    image: "/images/plan-pulse.png",
  },
  {
    key: "radar",
    name: "Radar",
    priceLabel: "$36 / month",
    priceUsd: 36,
    credits: 18_000,
    sorties: 10,
    watch: 120,
    suggests: 30,
    blurb: "Daily desk and a 120-post/day watch. Scout + analytics share the pool.",
    image: "/images/plan-radar.png",
  },
  {
    key: "horizon",
    name: "Horizon",
    priceLabel: "$99 / month",
    priceUsd: 99,
    credits: 40_000,
    sorties: 25,
    watch: 250,
    suggests: 40,
    blurb: "Wide field. 25 takeoffs and a 250-post/day watch for heavy desks.",
    image: "/images/plan-horizon.png",
  },
];
