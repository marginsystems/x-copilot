import { useRef, useState } from "react";
import { apiFetch } from "../lib/apiBase";
import type { UsageSummaryResponse, UsageWindow } from "./types";

export function useUsage() {
  const [usageWindow, setUsageWindow] = useState<UsageWindow>("7d");
  const [usage, setUsage] = useState<UsageSummaryResponse | null>(null);
  const [usageBusy, setUsageBusy] = useState(false);
  /** Monotonic token so out-of-order usage responses can't show the wrong window. */
  const usageRequestSeqRef = useRef(0);
  const [usageStatus, setUsageStatus] = useState("");

  async function loadUsage(window: UsageWindow = usageWindow) {
    const seq = ++usageRequestSeqRef.current;
    setUsageBusy(true);
    setUsageStatus("");
    try {
      const res = await apiFetch(
        `/api/usage?window=${encodeURIComponent(window)}`,
      );
      const data = (await res.json()) as UsageSummaryResponse;
      if (seq !== usageRequestSeqRef.current) return;
      if (!res.ok || data.ok === false) {
        setUsage(null);
        setUsageStatus(data.message || data.error || `Usage failed (${res.status})`);
        return;
      }
      setUsage(data);
      setUsageWindow(data.window ?? window);
    } catch (err) {
      if (seq !== usageRequestSeqRef.current) return;
      setUsage(null);
      setUsageStatus(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === usageRequestSeqRef.current) setUsageBusy(false);
    }
  }

  return {
    usageWindow,
    setUsageWindow,
    usage,
    usageBusy,
    usageStatus,
    loadUsage,
  };
}
