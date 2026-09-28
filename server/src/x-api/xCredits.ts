import { isRecord } from "../platform/unknownValue.js";
import { xApiGet, type XApiGetResult } from "./xApi.js";

export const X_CREDITS_PATH = "/usage/credits";
export const X_CREDITS_LOW_USD_DEFAULT = 10;
export const X_CREDITS_CACHE_MS = 10 * 60_000;
export const X_CREDITS_ERROR_CACHE_MS = 60_000;

export type XCreditBalance =
  | {
      ok: true;
      totalBalance: number;
      lowThreshold: number;
      low: boolean;
      checkedAt: string;
    }
  | { ok: false; status: number; error: string };

export function resolveXCreditsLowUsd(
  raw: string | undefined = process.env.X_CREDITS_LOW_USD,
): number {
  const value = Number(raw?.trim());
  return raw?.trim() && Number.isFinite(value) && value >= 0
    ? value
    : X_CREDITS_LOW_USD_DEFAULT;
}

export function parseXCreditTotalBalance(json: unknown): number | null {
  if (!isRecord(json) || !isRecord(json.data)) return null;
  const total = json.data.total_balance;
  return typeof total === "number" && Number.isFinite(total) ? total : null;
}

export function xCreditBalanceFromRead(
  read: XApiGetResult,
  lowThreshold: number,
  nowMs: number,
): XCreditBalance {
  if (!read.ok) {
    return { ok: false, status: read.status || 502, error: read.error };
  }
  const totalBalance = parseXCreditTotalBalance(read.json);
  if (totalBalance === null) {
    return { ok: false, status: 502, error: "x_credits_unparsed" };
  }
  return {
    ok: true,
    totalBalance,
    lowThreshold,
    low: totalBalance <= lowThreshold,
    checkedAt: new Date(nowMs).toISOString(),
  };
}

let cached: { atMs: number; balance: XCreditBalance } | null = null;

export function resetXCreditBalanceCacheForTests(): void {
  cached = null;
}

export async function readXCreditBalance(opts: {
  nowMs?: number;
  get?: typeof xApiGet;
  lowThreshold?: number;
} = {}): Promise<XCreditBalance> {
  const nowMs = opts.nowMs ?? Date.now();
  if (cached) {
    const ttl = cached.balance.ok ? X_CREDITS_CACHE_MS : X_CREDITS_ERROR_CACHE_MS;
    if (nowMs - cached.atMs < ttl) return cached.balance;
  }
  const read = await (opts.get ?? xApiGet)({
    path: X_CREDITS_PATH,
    skipUsage: true,
    timeoutMs: 10_000,
  });
  const balance = xCreditBalanceFromRead(
    read,
    opts.lowThreshold ?? resolveXCreditsLowUsd(),
    nowMs,
  );
  if (!balance.ok) {
    console.warn("[x-credits] balance read failed", balance.status, balance.error);
  }
  cached = { atMs: nowMs, balance };
  return balance;
}
