import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseDismissedXCreditsLevel,
  parseXCreditBalance,
  shouldShowXCreditsToast,
  xCreditsAlertLevel,
  xCreditsToastCopy,
} from "./xCredits.ts";

await describe("parseXCreditBalance", async () => {
  await it("reads the admin credits payload", () => {
    assert.deepEqual(
      parseXCreditBalance({
        ok: true,
        totalBalance: 4.5,
        lowThreshold: 10,
        low: true,
        checkedAt: "2026-09-28T00:00:00.000Z",
      }),
      { totalBalance: 4.5, lowThreshold: 10, low: true },
    );
  });

  await it("rejects error and malformed payloads", () => {
    assert.equal(parseXCreditBalance({ error: "forbidden" }), null);
    assert.equal(parseXCreditBalance({ totalBalance: "4", lowThreshold: 10, low: true }), null);
    assert.equal(parseXCreditBalance(null), null);
  });
});

await describe("xCreditsAlertLevel", async () => {
  await it("is empty at zero, low under the threshold, and quiet otherwise", () => {
    assert.equal(xCreditsAlertLevel({ totalBalance: 0, lowThreshold: 10, low: true }), "empty");
    assert.equal(xCreditsAlertLevel({ totalBalance: 6, lowThreshold: 10, low: true }), "low");
    assert.equal(xCreditsAlertLevel({ totalBalance: 60, lowThreshold: 10, low: false }), null);
    assert.equal(xCreditsAlertLevel(null), null);
  });
});

await describe("shouldShowXCreditsToast", async () => {
  await it("shows an undismissed alert", () => {
    assert.equal(shouldShowXCreditsToast("low", null), true);
    assert.equal(shouldShowXCreditsToast("empty", null), true);
  });

  await it("stays hidden after dismissal until credits run out", () => {
    assert.equal(shouldShowXCreditsToast("low", "low"), false);
    assert.equal(shouldShowXCreditsToast("empty", "low"), true);
    assert.equal(shouldShowXCreditsToast("empty", "empty"), false);
    assert.equal(shouldShowXCreditsToast("low", "empty"), false);
  });

  await it("never shows without an alert", () => {
    assert.equal(shouldShowXCreditsToast(null, null), false);
  });
});

await describe("parseDismissedXCreditsLevel", async () => {
  await it("accepts only known levels", () => {
    assert.equal(parseDismissedXCreditsLevel("low"), "low");
    assert.equal(parseDismissedXCreditsLevel("empty"), "empty");
    assert.equal(parseDismissedXCreditsLevel("1"), null);
    assert.equal(parseDismissedXCreditsLevel(null), null);
  });
});

await describe("xCreditsToastCopy", async () => {
  await it("names the balance and threshold when low", () => {
    const copy = xCreditsToastCopy({ totalBalance: 4.5, lowThreshold: 10, low: true });
    assert.equal(copy.title, "X API credits low");
    assert.match(copy.body, /\$4\.50 left \(alert at \$10\.00\)/);
  });

  await it("says what stops when empty", () => {
    const copy = xCreditsToastCopy({ totalBalance: 0, lowThreshold: 10, low: true });
    assert.equal(copy.title, "X API credits empty");
    assert.match(copy.body, /own-post detection/);
  });
});
