import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isNonProductionEnv,
  planKeyFromStripePriceId,
  resolveStripePriceId,
  stripeSecretPresent,
} from "./stripeConfig.ts";

describe("stripeConfig", () => {
  const keys = [
    "NODE_ENV",
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_PULSE",
    "STRIPE_PRICE_PULSE_DEV",
    "STRIPE_PRICE_RADAR",
    "STRIPE_PRICE_HORIZON",
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
});
