import { isRecord } from "../lib/typeGuards";
import { useSession } from "../auth/session";
import { parseBilling, payloadError } from "../lib/routePayloads";
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
  const session = useSession();
  const [billing, setBilling] = useState<BillingMe | null>(null);
  const [billingNotice, setBillingNotice] = useState("");
  const [checkoutPlan, setCheckoutPlan] = useState<PaidPlanKey | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);

  async function loadBilling(clearNotice = true) {
    const generation = session.capture();
    if (!session.isCurrent(generation)) return;
    try {
      const res = await apiFetch("/api/billing/me");
      if (!session.isCurrent(generation)) return;
      const raw: unknown = await res.json();
      if (!session.isCurrent(generation)) return;
      const data = parseBilling(raw);
      if (!res.ok || !data) {
        setBillingNotice(payloadError(raw, `Billing failed (${res.status}): invalid response`));
        return;
      }
      setBilling(data);
      if (clearNotice) setBillingNotice("");
    } catch (err) {
      if (!session.isCurrent(generation)) return;
      setBillingNotice(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmCheckout(sessionId: string) {
    const generation = session.capture();
    if (!session.isCurrent(generation)) return;
    try {
      const res = await apiFetch("/api/stripe/checkout/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!session.isCurrent(generation)) return;
      const raw: unknown = await res.json();
      if (!session.isCurrent(generation)) return;
      const data = isRecord(raw) && !Array.isArray(raw) ? raw : {};
      if (!res.ok || data.ok !== true || (data.plan_key !== undefined && typeof data.plan_key !== "string")) {
        setBillingNotice(
          payloadError(raw, "Could not confirm checkout yet. Refresh in a moment."),
        );
        return;
      }
      setBillingNotice(
        data.plan_key
          ? `You're on ${data.plan_key}. Credits reset each UTC month.`
          : "Subscription active.",
      );
      await loadBilling(false);
    } catch (err) {
      if (!session.isCurrent(generation)) return;
      setBillingNotice(err instanceof Error ? err.message : String(err));
    }
  }

  async function onSubscribe(plan: PaidPlanKey) {
    const generation = session.capture();
    if (!session.isCurrent(generation)) return;
    setCheckoutPlan(plan);
    setBillingNotice("");
    try {
      const res = await apiFetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!session.isCurrent(generation)) return;
      const raw: unknown = await res.json();
      if (!session.isCurrent(generation)) return;
      const data = isRecord(raw) && !Array.isArray(raw) ? raw : {};
      if (!res.ok || typeof data.url !== "string" || !data.url) {
        setBillingNotice(payloadError(raw, `Checkout failed (${res.status})`));
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      if (!session.isCurrent(generation)) return;
      setBillingNotice(err instanceof Error ? err.message : String(err));
    } finally {
      if (!session.isCurrent(generation)) return;
      setCheckoutPlan(null);
    }
  }

  async function onManageBilling() {
    const generation = session.capture();
    if (!session.isCurrent(generation)) return;
    setPortalBusy(true);
    setBillingNotice("");
    try {
      const res = await apiFetch("/api/stripe/portal", { method: "POST" });
      if (!session.isCurrent(generation)) return;
      const raw: unknown = await res.json();
      if (!session.isCurrent(generation)) return;
      const data = isRecord(raw) && !Array.isArray(raw) ? raw : {};
      if (!res.ok || typeof data.url !== "string" || !data.url) {
        setBillingNotice(payloadError(raw, `Portal failed (${res.status})`));
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      if (!session.isCurrent(generation)) return;
      setBillingNotice(err instanceof Error ? err.message : String(err));
    } finally {
      if (!session.isCurrent(generation)) return;
      setPortalBusy(false);
    }
  }

  useEffect(() => {
    const generation = session.capture();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const now = new Date();
      const nextUtcDay = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
      );
      timer = setTimeout(() => {
        if (!session.isCurrent(generation)) return;
        loadBilling().catch((err: unknown) => {
          if (!session.isCurrent(generation)) return;
          setBillingNotice(err instanceof Error ? err.message : String(err));
        });
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
