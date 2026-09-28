import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  X_CREDITS_CACHE_MS,
  X_CREDITS_ERROR_CACHE_MS,
  X_CREDITS_LOW_USD_DEFAULT,
  X_CREDITS_PATH,
  parseXCreditTotalBalance,
  readXCreditBalance,
  resetXCreditBalanceCacheForTests,
  resolveXCreditsLowUsd,
} from "./xCredits.ts";
import type { XApiGetResult, xApiGet } from "./xApi.ts";

function creditsJson(total: number): unknown {
  return {
    data: {
      total_balance: total,
      prepaid_balance: total,
      free_balance: 0,
      free_grants: [],
    },
  };
}

function stubGet(results: XApiGetResult[]): {
  get: typeof xApiGet;
  calls: Parameters<typeof xApiGet>[0][];
} {
  const calls: Parameters<typeof xApiGet>[0][] = [];
  const get: typeof xApiGet = (opts) => {
    calls.push(opts);
    const next = results.shift();
    if (!next) throw new Error("unexpected X credits read");
    return Promise.resolve(next);
  };
  return { get, calls };
}

await describe("parseXCreditTotalBalance", async () => {
  await it("reads data.total_balance in USD", () => {
    assert.equal(parseXCreditTotalBalance(creditsJson(12.5)), 12.5);
  });

  await it("rejects payloads without a numeric total_balance", () => {
    assert.equal(parseXCreditTotalBalance({}), null);
    assert.equal(parseXCreditTotalBalance({ data: { total_balance: "3" } }), null);
    assert.equal(parseXCreditTotalBalance(null), null);
  });
});

await describe("resolveXCreditsLowUsd", async () => {
  await it("defaults when unset or invalid", () => {
    assert.equal(resolveXCreditsLowUsd(undefined), X_CREDITS_LOW_USD_DEFAULT);
    assert.equal(resolveXCreditsLowUsd(""), X_CREDITS_LOW_USD_DEFAULT);
    assert.equal(resolveXCreditsLowUsd("abc"), X_CREDITS_LOW_USD_DEFAULT);
    assert.equal(resolveXCreditsLowUsd("-1"), X_CREDITS_LOW_USD_DEFAULT);
  });

  await it("accepts a non-negative USD amount", () => {
    assert.equal(resolveXCreditsLowUsd("25"), 25);
    assert.equal(resolveXCreditsLowUsd("0"), 0);
  });
});

await describe("readXCreditBalance", async () => {
  beforeEach(() => {
    resetXCreditBalanceCacheForTests();
  });

  await it("flags the balance low at or under the threshold without billing a usage row", async () => {
    const { get, calls } = stubGet([
      { ok: true, status: 200, json: creditsJson(10) },
    ]);
    const balance = await readXCreditBalance({ get, lowThreshold: 10, nowMs: 0 });
    assert.deepEqual(balance, {
      ok: true,
      totalBalance: 10,
      lowThreshold: 10,
      low: true,
      checkedAt: new Date(0).toISOString(),
    });
    assert.equal(calls[0]?.path, X_CREDITS_PATH);
    assert.equal(calls[0]?.skipUsage, true);
  });

  await it("reports a healthy balance as not low", async () => {
    const { get } = stubGet([{ ok: true, status: 200, json: creditsJson(42) }]);
    const balance = await readXCreditBalance({ get, lowThreshold: 10, nowMs: 0 });
    assert.equal(balance.ok && balance.low, false);
  });

  await it("serves the cached balance until the cache expires", async () => {
    const { get, calls } = stubGet([
      { ok: true, status: 200, json: creditsJson(42) },
      { ok: true, status: 200, json: creditsJson(3) },
    ]);
    await readXCreditBalance({ get, lowThreshold: 10, nowMs: 0 });
    const cachedRead = await readXCreditBalance({
      get,
      lowThreshold: 10,
      nowMs: X_CREDITS_CACHE_MS - 1,
    });
    assert.equal(cachedRead.ok && cachedRead.totalBalance, 42);
    const fresh = await readXCreditBalance({
      get,
      lowThreshold: 10,
      nowMs: X_CREDITS_CACHE_MS,
    });
    assert.equal(fresh.ok && fresh.totalBalance, 3);
    assert.equal(calls.length, 2);
  });

  await it("retries a failed read after the short error cache", async () => {
    const { get, calls } = stubGet([
      {
        ok: false,
        status: 401,
        error: "unauthorized",
        message: "X API HTTP 401",
      },
      { ok: true, status: 200, json: creditsJson(7) },
    ]);
    const failed = await readXCreditBalance({ get, lowThreshold: 10, nowMs: 0 });
    assert.deepEqual(failed, { ok: false, status: 401, error: "unauthorized" });
    await readXCreditBalance({ get, lowThreshold: 10, nowMs: X_CREDITS_ERROR_CACHE_MS - 1 });
    assert.equal(calls.length, 1);
    const retried = await readXCreditBalance({
      get,
      lowThreshold: 10,
      nowMs: X_CREDITS_ERROR_CACHE_MS,
    });
    assert.equal(retried.ok && retried.totalBalance, 7);
  });

  await it("treats an unparseable payload as a failed read", async () => {
    const { get } = stubGet([{ ok: true, status: 200, json: { data: {} } }]);
    const balance = await readXCreditBalance({ get, lowThreshold: 10, nowMs: 0 });
    assert.deepEqual(balance, { ok: false, status: 502, error: "x_credits_unparsed" });
  });
});
