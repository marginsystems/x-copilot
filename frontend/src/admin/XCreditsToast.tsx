import { useEffect, useState } from "react";
import { apiFetch } from "../lib/apiBase";
import {
  X_CREDITS_ADMIN_PATH,
  X_CREDITS_POLL_MS,
  X_CREDITS_TOAST_DISMISS_KEY,
  parseDismissedXCreditsLevel,
  parseXCreditBalance,
  shouldShowXCreditsToast,
  xCreditsAlertLevel,
  xCreditsToastCopy,
  type XCreditBalance,
  type XCreditsAlertLevel,
} from "../lib/xCredits";

function readDismissedLevel(): XCreditsAlertLevel | null {
  try {
    return parseDismissedXCreditsLevel(
      sessionStorage.getItem(X_CREDITS_TOAST_DISMISS_KEY),
    );
  } catch {
    return null;
  }
}

function writeDismissedLevel(level: XCreditsAlertLevel | null): void {
  if (!level) return;
  try {
    sessionStorage.setItem(X_CREDITS_TOAST_DISMISS_KEY, level);
  } catch {
    return;
  }
}

function useXCreditBalance(enabled: boolean): XCreditBalance | null {
  const [balance, setBalance] = useState<XCreditBalance | null>(null);
  useEffect(() => {
    if (!enabled) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      apiFetch(X_CREDITS_ADMIN_PATH)
        .then(async (res) => (res.ok ? parseXCreditBalance(await res.json()) : null))
        .then((next) => {
          if (!cancelled && next) setBalance(next);
        })
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, X_CREDITS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);
  return balance;
}

export function XCreditsToast({ enabled }: { enabled: boolean }) {
  const balance = useXCreditBalance(enabled);
  const [dismissed, setDismissed] = useState(readDismissedLevel);
  const level = xCreditsAlertLevel(balance);
  if (!enabled || !balance || !shouldShowXCreditsToast(level, dismissed)) {
    return null;
  }
  const copy = xCreditsToastCopy(balance);
  return (
    <aside className="x-credits-toast" role="alert" aria-label={copy.title}>
      <div className="x-credits-toast-copy">
        <p className="x-credits-toast-title">{copy.title}</p>
        <p className="x-credits-toast-body">{copy.body}</p>
      </div>
      <button
        type="button"
        className="ghost"
        onClick={() => {
          writeDismissedLevel(level);
          setDismissed(level);
        }}
      >
        Dismiss
      </button>
    </aside>
  );
}
