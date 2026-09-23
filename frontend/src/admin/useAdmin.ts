import { isRecord } from "../lib/typeGuards";
import { useState } from "react";
import type { AdminTenantRow } from "../AdminPanel";
import { apiFetch } from "../lib/apiBase";

function isAdminTenantRow(raw: unknown): raw is AdminTenantRow {
  return isRecord(raw) &&
    ["tenantId", "slug", "name", "createdAt", "planKey"].every((key) => typeof raw[key] === "string") &&
    ["userId", "email", "subscriptionStatus"].every((key) => raw[key] === null || typeof raw[key] === "string") &&
    ["postsRead", "estimatedUsd", "creditLimit"].every((key) => typeof raw[key] === "number") &&
    (raw.grantPlanKey === undefined || raw.grantPlanKey === null || typeof raw.grantPlanKey === "string") &&
    (raw.manualGrant === undefined || typeof raw.manualGrant === "boolean");
}

export function useAdmin() {
  const [adminTenants, setAdminTenants] = useState<AdminTenantRow[] | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState("");

  async function loadAdmin() {
    setAdminBusy(true);
    setAdminError("");
    try {
      const res = await apiFetch("/api/admin/tenants");
      const raw: unknown = await res.json();
      const data = isRecord(raw) ? raw : {};
      if (!res.ok) {
        setAdminTenants(null);
        setAdminError((typeof data.message === "string" && data.message) || (typeof data.error === "string" && data.error) || `Admin failed (${res.status})`);
        return;
      }
      setAdminTenants(Array.isArray(data.tenants) ? data.tenants.filter(isAdminTenantRow) : []);
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
