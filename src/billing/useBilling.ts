import { useEffect, useState } from "react";
import {
  type BillingMe,
  type PaidPlanKey,
} from "../BillingPanel";
import { apiFetch } from "../lib/apiBase";

type UseBillingOptions = {
  onUtcDay?: () => void;
};

export function useBilling({ onUtcDay }: UseBillingOptions = {}) {
  const [billing, setBilling] = useState<BillingMe | null>(null);
  const [billingNotice, setBillingNotice] = useState("");
  const [checkoutPlan, setCheckoutPlan] = useState<PaidPlanKey | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);

  async function loadBilling() {
    try {
      const res = await apiFetch("/api/billing/me");
      const data = (await res.json()) as BillingMe;
      if (!res.ok) {
        setBillingNotice(data.message || data.error || `Billing failed (${res.status})`);
        return;
      }
      setBilling(data);
    } catch (err) {
      setBillingNotice(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmCheckout(sessionId: string) {
    try {
      const res = await apiFetch("/api/stripe/checkout/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        plan_key?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setBillingNotice(
          data.message ||
            data.error ||
            "Could not confirm checkout yet. Refresh in a moment.",
        );
        return;
      }
      setBillingNotice(
        data.plan_key
          ? `You're on ${data.plan_key}. Credits reset each UTC month.`
          : "Subscription active.",
      );
      await loadBilling();
    } catch (err) {
      setBillingNotice(err instanceof Error ? err.message : String(err));
    }
  }

  async function onSubscribe(plan: PaidPlanKey) {
    setCheckoutPlan(plan);
    setBillingNotice("");
    try {
      const res = await apiFetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json()) as {
        url?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.url) {
        setBillingNotice(data.message || data.error || `Checkout failed (${res.status})`);
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      setBillingNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckoutPlan(null);
    }
  }

  async function onManageBilling() {
    setPortalBusy(true);
    setBillingNotice("");
    try {
      const res = await apiFetch("/api/stripe/portal", { method: "POST" });
      const data = (await res.json()) as {
        url?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.url) {
        setBillingNotice(data.message || data.error || `Portal failed (${res.status})`);
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      setBillingNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setPortalBusy(false);
    }
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const now = new Date();
      const nextUtcDay = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
      );
      timer = setTimeout(() => {
        void loadBilling();
        onUtcDay?.();
        arm();
      }, Math.max(0, nextUtcDay - Date.now()) + 500);
    };
    arm();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  return {
    billing,
    billingNotice,
    setBillingNotice,
    checkoutPlan,
    portalBusy,
    loadBilling,
    confirmCheckout,
    onSubscribe,
    onManageBilling,
  };
}
