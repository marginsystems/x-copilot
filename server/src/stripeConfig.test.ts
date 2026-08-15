import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isNonProductionEnv,
  liveStripeKeyBlockedInNonProduction,
  planKeyFromStripePriceId,
  resolvePortalConfigurationId,
  resolveStripePriceId,
  resolveWebhookSecret,
  stripeSecretKind,
  stripeSecretPresent,
} from "./stripeConfig.ts";

describe("stripeConfig", () => {
  const keys = [
    "NODE_ENV",
    "STRIPE_SECRET_KEY",
    "STRIPE_SECRET_KEY_DEV",
    "STRIPE_PRICE_PULSE",
    "STRIPE_PRICE_PULSE_DEV",
    "STRIPE_PRICE_RADAR",
    "STRIPE_PRICE_RADAR_DEV",
    "STRIPE_PRICE_HORIZON",
    "STRIPE_PRICE_HORIZON_DEV",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_WEBHOOK_SECRET_DEV",
    "STRIPE_PORTAL_CONFIGURATION_ID",
    "STRIPE_PORTAL_CONFIGURATION_ID_DEV",
  ];
  const snapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) snapshot[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of keys) {
      if (snapshot[key] === undefined) delete process.env[key];
      else process.env[key] = snapshot[key];
    }
  });

  it("prefers _DEV prices outside production", () => {
    process.env.NODE_ENV = "development";
    process.env.STRIPE_PRICE_PULSE = "price_prod";
    process.env.STRIPE_PRICE_PULSE_DEV = "price_dev";
    assert.equal(isNonProductionEnv(), true);
    assert.equal(resolveStripePriceId("pulse"), "price_dev");
    assert.equal(planKeyFromStripePriceId("price_dev"), "pulse");
    assert.equal(planKeyFromStripePriceId("price_prod"), "pulse");
    assert.equal(planKeyFromStripePriceId("price_other"), null);
  });

  it("uses prod prices when NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    process.env.STRIPE_PRICE_PULSE = "price_prod";
    process.env.STRIPE_PRICE_PULSE_DEV = "price_dev";
    assert.equal(resolveStripePriceId("pulse"), "price_prod");
  });

  it("does not treat missing secret as configured", () => {
    delete process.env.STRIPE_SECRET_KEY;
    assert.equal(stripeSecretPresent(), false);
  });

  it("resolves all three DEV prices off production and maps both ids", () => {
    process.env.NODE_ENV = "development";
    process.env.STRIPE_PRICE_PULSE = "price_live_pulse";
    process.env.STRIPE_PRICE_PULSE_DEV = "price_dev_pulse";
    process.env.STRIPE_PRICE_RADAR = "price_live_radar";
    process.env.STRIPE_PRICE_RADAR_DEV = "price_dev_radar";
    process.env.STRIPE_PRICE_HORIZON = "price_live_horizon";
    process.env.STRIPE_PRICE_HORIZON_DEV = "price_dev_horizon";
    assert.equal(resolveStripePriceId("pulse"), "price_dev_pulse");
    assert.equal(resolveStripePriceId("radar"), "price_dev_radar");
    assert.equal(resolveStripePriceId("horizon"), "price_dev_horizon");
    assert.equal(planKeyFromStripePriceId("price_live_radar"), "radar");
    assert.equal(planKeyFromStripePriceId("price_dev_horizon"), "horizon");
  });

  it("falls back to live prices when _DEV is empty", () => {
    process.env.NODE_ENV = "development";
    process.env.STRIPE_PRICE_PULSE = "price_live_pulse";
    delete process.env.STRIPE_PRICE_PULSE_DEV;
    assert.equal(resolveStripePriceId("pulse"), "price_live_pulse");
  });

  it("prefers DEV webhook and portal ids off production", () => {
    process.env.NODE_ENV = "development";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_live";
    process.env.STRIPE_WEBHOOK_SECRET_DEV = "whsec_dev";
    process.env.STRIPE_PORTAL_CONFIGURATION_ID = "bpc_live";
    process.env.STRIPE_PORTAL_CONFIGURATION_ID_DEV = "bpc_dev";
    assert.equal(resolveWebhookSecret(), "whsec_dev");
    assert.equal(resolvePortalConfigurationId(), "bpc_dev");
    process.env.NODE_ENV = "production";
    assert.equal(resolveWebhookSecret(), "whsec_live");
    assert.equal(resolvePortalConfigurationId(), "bpc_live");
  });

  it("blocks a live secret outside production", () => {
    process.env.NODE_ENV = "development";
    process.env.STRIPE_SECRET_KEY = "sk_live_example";
    delete process.env.STRIPE_SECRET_KEY_DEV;
    assert.equal(stripeSecretKind(), "live");
    assert.equal(liveStripeKeyBlockedInNonProduction(), true);
    process.env.NODE_ENV = "production";
    assert.equal(liveStripeKeyBlockedInNonProduction(), false);
    process.env.STRIPE_SECRET_KEY = "sk_test_example";
    process.env.NODE_ENV = "development";
    assert.equal(stripeSecretKind(), "test");
    assert.equal(liveStripeKeyBlockedInNonProduction(), false);
  });

  it("prefers STRIPE_SECRET_KEY_DEV off production so a live key can stay in .env", () => {
    process.env.NODE_ENV = "development";
    process.env.STRIPE_SECRET_KEY = "sk_live_example";
    process.env.STRIPE_SECRET_KEY_DEV = "sk_test_example";
    assert.equal(stripeSecretKind(), "test");
    assert.equal(liveStripeKeyBlockedInNonProduction(), false);
    process.env.NODE_ENV = "production";
    assert.equal(stripeSecretKind(), "live");
  });

  it("classifies restricted rk_live_ keys as live and blocks them off production", () => {
    process.env.NODE_ENV = "development";
    process.env.STRIPE_SECRET_KEY = "rk_live_example";
    delete process.env.STRIPE_SECRET_KEY_DEV;
    assert.equal(stripeSecretKind(), "live");
    assert.equal(liveStripeKeyBlockedInNonProduction(), true);
    process.env.NODE_ENV = "production";
    assert.equal(liveStripeKeyBlockedInNonProduction(), false);
  });

  it("classifies rk_test_ keys as test so they are not blocked", () => {
    process.env.NODE_ENV = "development";
    process.env.STRIPE_SECRET_KEY = "rk_test_example";
    delete process.env.STRIPE_SECRET_KEY_DEV;
    assert.equal(stripeSecretKind(), "test");
    assert.equal(liveStripeKeyBlockedInNonProduction(), false);
  });

  it("fails closed for unrecognized non-empty keys off production", () => {
    process.env.NODE_ENV = "development";
    process.env.STRIPE_SECRET_KEY = "sk_malformed";
    delete process.env.STRIPE_SECRET_KEY_DEV;
    assert.equal(stripeSecretKind(), "live");
    assert.equal(liveStripeKeyBlockedInNonProduction(), true);
    process.env.NODE_ENV = "production";
    assert.equal(liveStripeKeyBlockedInNonProduction(), false);
  });
});
