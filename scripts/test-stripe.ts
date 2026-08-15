#!/usr/bin/env npx tsx
/**
 * Stripe test-mode smoke — loads .env and retrieves Pulse / Radar / Horizon.
 *
 *   npm run test:stripe
 *
 * Uses sk_test_… plus STRIPE_PRICE_*_DEV (or live IDs if _DEV is empty).
 * Refuses a live secret unless you pass --live. Never prints secret values.
 */
import { resolve } from "node:path";
import Stripe from "stripe";
import { loadEnv } from "../server/src/loadEnv.js";
import { PAID_PLAN_KEYS, PLAN_PRICE_USD, type PaidPlanKey } from "../server/src/plans.js";
import {
  isNonProductionEnv,
  liveStripeKeyBlockedInNonProduction,
  resolvePortalConfigurationId,
  resolveStripePriceId,
  resolveStripeSecretKey,
  resolveWebhookSecret,
  stripeSecretKind,
} from "../server/src/stripeConfig.js";

const envPath = resolve(process.cwd(), ".env");
if (!loadEnv(envPath)) {
  console.error("FAIL: no .env file. Run: cp .env.example .env");
  process.exit(1);
}

const allowLive = process.argv.includes("--live");
const kind = stripeSecretKind();
const nodeEnv = process.env.NODE_ENV?.trim() || "(unset)";

console.log("x-copilot Stripe smoke");
console.log(`  .env:              ${envPath}`);
console.log(`  NODE_ENV:          ${nodeEnv} (non-prod=${isNonProductionEnv()})`);
console.log(`  secret kind:       ${kind}`);
console.log(`  webhook secret:    ${resolveWebhookSecret() ? "set" : "missing"}`);
console.log(
  `  portal config:     ${resolvePortalConfigurationId() ? "set" : "missing"}`,
);

if (kind === "missing") {
  console.error("\nFAIL: no Stripe secret. Set STRIPE_SECRET_KEY_DEV=sk_test_…");
  console.error(
    "Dashboard → Developers → API keys. Test mode toggle ON → Secret key.",
  );
  process.exit(1);
}

if (kind === "live" && !allowLive) {
  console.error("\nFAIL: live secret on a smoke run. Use sk_test_… or pass --live.");
  process.exit(1);
}

if (liveStripeKeyBlockedInNonProduction() && !allowLive) {
  console.error(
    "\nFAIL: NODE_ENV is not production and the secret is live. Checkout is blocked.",
  );
  process.exit(1);
}

const secret = allowLive
  ? (process.env.STRIPE_SECRET_KEY?.trim() ?? null)
  : resolveStripeSecretKey();
if (!secret) {
  console.error("\nFAIL: no Stripe secret after resolve.");
  process.exit(1);
}
const stripe = new Stripe(secret, { apiVersion: "2025-02-24.acacia" });

let failed = 0;
for (const tier of PAID_PLAN_KEYS) {
  const baseKey = `STRIPE_PRICE_${tier.toUpperCase()}`;
  const priceId = allowLive
    ? (process.env[baseKey]?.trim() ?? null)
    : resolveStripePriceId(tier);
  const wantCents = PLAN_PRICE_USD[tier] * 100;
  if (!priceId) {
    console.error(`FAIL: ${tier}: no ${baseKey}${allowLive ? "" : "(_DEV)"}`);
    failed += 1;
    continue;
  }
  try {
    const price = await stripe.prices.retrieve(priceId);
    const amount = price.unit_amount;
    const interval = price.recurring?.interval;
    const ok = amount === wantCents && interval === "month" && price.active;
    console.log(
      `  ${tier}: ${ok ? "ok" : "MISMATCH"}  ${priceId}  ${amount ?? "?"}¢ / ${interval ?? "n/a"}`,
    );
    if (!ok) {
      console.error(
        `FAIL: ${tier} expected ${wantCents}¢ monthly active, got ${amount}¢ ${interval} active=${price.active}`,
      );
      failed += 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`FAIL: ${tier} retrieve ${priceId}: ${message}`);
    failed += 1;
  }
}

const portalId = allowLive
  ? (process.env.STRIPE_PORTAL_CONFIGURATION_ID?.trim() ?? null)
  : resolvePortalConfigurationId();
if (portalId) {
  try {
    const cfg = await stripe.billingPortal.configurations.retrieve(portalId);
    console.log(`  portal: ok  ${cfg.id}  active=${cfg.active}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`FAIL: portal ${portalId}: ${message}`);
    failed += 1;
  }
} else {
  console.log("  portal: skipped (STRIPE_PORTAL_CONFIGURATION_ID unset)");
}

if (failed) {
  console.error(`\nFAIL: ${failed} check(s)`);
  process.exit(1);
}
console.log("\nOK");
