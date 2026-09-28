import { isRecord } from "./typeGuards";

export const X_CREDITS_ADMIN_PATH = "/api/admin/x-credits";
export const X_CREDITS_POLL_MS = 15 * 60_000;
export const X_CREDITS_TOAST_DISMISS_KEY = "xcopilot:x-credits-toast-dismissed";

export type XCreditBalance = {
  totalBalance: number;
  lowThreshold: number;
  low: boolean;
};

export type XCreditsAlertLevel = "low" | "empty";

export function parseXCreditBalance(raw: unknown): XCreditBalance | null {
  if (!isRecord(raw)) return null;
  const { totalBalance, lowThreshold, low } = raw;
  if (typeof totalBalance !== "number" || !Number.isFinite(totalBalance)) return null;
  if (typeof lowThreshold !== "number" || !Number.isFinite(lowThreshold)) return null;
  if (typeof low !== "boolean") return null;
  return { totalBalance, lowThreshold, low };
}

export function xCreditsAlertLevel(
  balance: XCreditBalance | null,
): XCreditsAlertLevel | null {
  if (!balance) return null;
  if (balance.totalBalance <= 0) return "empty";
  return balance.low ? "low" : null;
}

export function shouldShowXCreditsToast(
  level: XCreditsAlertLevel | null,
  dismissed: XCreditsAlertLevel | null,
): boolean {
  if (!level) return false;
  if (!dismissed) return true;
  return level === "empty" && dismissed === "low";
}

export function parseDismissedXCreditsLevel(
  raw: string | null,
): XCreditsAlertLevel | null {
  return raw === "low" || raw === "empty" ? raw : null;
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function xCreditsToastCopy(balance: XCreditBalance): {
  title: string;
  body: string;
} {
  if (balance.totalBalance <= 0) {
    return {
      title: "X API credits empty",
      body: "Scout, own-post detection, and the webhook are paused until you top up X API credits.",
    };
  }
  return {
    title: "X API credits low",
    body: `${formatUsd(balance.totalBalance)} left (alert at ${formatUsd(balance.lowThreshold)}). Top up X API credits before Scout and own-post detection stop.`,
  };
}
