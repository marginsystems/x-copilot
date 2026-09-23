import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseConsent } from "./consent.ts";
import { applyAnalyticsConsent } from "./analytics.ts";

describe("parseConsent", () => {
  it("accepts only explicit choices", () => {
    assert.equal(parseConsent("accepted"), "accepted");
    assert.equal(parseConsent("rejected"), "rejected");
    assert.equal(parseConsent(null), null);
    assert.equal(parseConsent("granted"), null);
  }).catch(assert.fail);

});

describe("applyAnalyticsConsent", () => {
  it("maps accepted to granted and rejected to denied", () => {
    const calls: unknown[][] = [];
    const gtag = (...args: unknown[]) => calls.push(args);
    const prevWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: { gtag } });
    try {
      applyAnalyticsConsent("accepted");
      applyAnalyticsConsent("rejected");
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: prevWindow });
    }
    assert.deepEqual(calls, [
      ["consent", "update", { analytics_storage: "granted" }],
      ["consent", "update", { analytics_storage: "denied" }],
    ]);
  }).catch(assert.fail);
});
