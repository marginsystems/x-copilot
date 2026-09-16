import { useSession } from "../auth/session";
import { parseUsage, payloadError } from "../lib/routePayloads";
import { useRef, useState } from "react";
import { apiFetch } from "../lib/apiBase";
import type { UsageSummaryResponse, UsageWindow } from "./types";

export function useUsage() {
  const session = useSession();
  const [usageWindow, setUsageWindow] = useState<UsageWindow>("7d");
  const [usage, setUsage] = useState<UsageSummaryResponse | null>(null);
  const [usageBusy, setUsageBusy] = useState(false);
  /** Monotonic token so out-of-order usage responses can't show the wrong window. */
  const usageRequestSeqRef = useRef(0);
  const [usageStatus, setUsageStatus] = useState("");

  async function loadUsage(window: UsageWindow = usageWindow) {
    const generation = session.capture();
    if (!session.isCurrent(generation)) return;
    const seq = ++usageRequestSeqRef.current;
    setUsageBusy(true);
    setUsageStatus("");
    try {
      const res = await apiFetch(
        `/api/usage?window=${encodeURIComponent(window)}`,
      );
      if (!session.isCurrent(generation)) return;
      const raw: unknown = await res.json();
      if (!session.isCurrent(generation)) return;
      const data = parseUsage(raw);
      if (seq !== usageRequestSeqRef.current) return;
      if (!res.ok || !data) {
        setUsageStatus(payloadError(raw, `Usage failed (${res.status}): invalid response`));
        return;
      }
      setUsage(data);
      setUsageWindow(data.window ?? window);
    } catch (err) {
      if (!session.isCurrent(generation)) return;
      if (seq !== usageRequestSeqRef.current) return;
      setUsageStatus(err instanceof Error ? err.message : String(err));
    } finally {
      if (!session.isCurrent(generation)) return;
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
