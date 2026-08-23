import { useState } from "react";
import type { AdminTenantRow } from "../AdminPanel";
import { apiFetch } from "../lib/apiBase";

export function useAdmin() {
  const [adminTenants, setAdminTenants] = useState<AdminTenantRow[] | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState("");

  async function loadAdmin() {
    setAdminBusy(true);
    setAdminError("");
    try {
      const res = await apiFetch("/api/admin/tenants");
      const data = (await res.json()) as {
        ok?: boolean;
        tenants?: AdminTenantRow[];
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setAdminTenants(null);
        setAdminError(data.message || data.error || `Admin failed (${res.status})`);
        return;
      }
      setAdminTenants(data.tenants ?? []);
    } catch (err) {
      setAdminTenants(null);
      setAdminError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdminBusy(false);
    }
  }

  return {
    adminTenants,
    adminBusy,
    adminError,
    loadAdmin,
  };
}
