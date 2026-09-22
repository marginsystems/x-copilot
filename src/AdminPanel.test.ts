import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAdminTenantUsageResponse } from "./AdminPanel";

await describe("admin usage response validation", async () => {
  const row = {
    id: "request-1", at: "2026-09-22T00:00:00Z", method: "GET",
    path: "/tweets", status: 200, error: null, postsRead: 3, estimatedUsd: 0.015,
    credits: 3, remaining: null, activity: "scout",
  };

  await it("accepts usage rows and optional error envelopes without changing values", () => {
    const response: unknown = { ok: true, window: "7d", recent: [row], remaining: null };
    assert.ok(isAdminTenantUsageResponse(response));
    assert.deepEqual(response.recent, [row]);
    assert.equal(isAdminTenantUsageResponse({ message: "Unavailable" }), true);
    assert.equal(isAdminTenantUsageResponse({}), true);
  });

  await it("rejects invalid nested rows and optional fields before rendering", () => {
    for (const response of [null, { recent: {} }, { recent: [null] },
      { recent: [{ ...row, estimatedUsd: "0.015" }] },
      { recent: [{ ...row, credits: {} }] }, { tenant: {} },
      { window: "month" }, { message: {} }, { remaining: "3" }]) {
      assert.equal(isAdminTenantUsageResponse(response), false);
    }
  });
});
