import { useRef, useState } from "react";
import { apiFetch } from "./lib/apiBase";
import { isOneOf, isRecord } from "./lib/typeGuards";

export type AdminTenantRow = {
  tenantId: string;
  slug: string;
  name: string;
  createdAt: string;
  userId: string | null;
  email: string | null;
  planKey: string;
  subscriptionStatus: string | null;
  grantPlanKey?: string | null;
  manualGrant?: boolean;
  postsRead: number;
  estimatedUsd: number;
  creditLimit: number;
};

type UsageWindow = "24h" | "7d" | "all";

type AdminUsageLogRow = {
  id: string;
  at: string;
  method: string;
  path: string;
  status: number;
  error: string | null;
  postsRead: number;
  estimatedUsd: number;
  activity?: string;
  credits?: number;
  remaining?: number | null;
};

type AdminTenantUsageResponse = {
  ok?: boolean;
  tenant?: AdminTenantRow;
  window?: UsageWindow;
  calls?: number;
  postsRead?: number;
  estimatedUsd?: number;
  remaining?: number | null;
  creditLimit?: number | null;
  recent?: AdminUsageLogRow[];
  error?: string;
  message?: string;
};

export function isAdminTenantUsageResponse(value: unknown): value is AdminTenantUsageResponse {
  if (!isRecord(value)) return false;
  if (!["calls", "postsRead", "estimatedUsd"].every((key) => value[key] === undefined || typeof value[key] === "number")) return false;
  if (!["remaining", "creditLimit"].every((key) => value[key] == null || typeof value[key] === "number")) return false;
  if (!["error", "message"].every((key) => value[key] === undefined || typeof value[key] === "string")) return false;
  if (value.ok !== undefined && typeof value.ok !== "boolean") return false;
  if (value.window !== undefined && !isOneOf(value.window, ["24h", "7d", "all"])) return false;
  if (value.tenant !== undefined) {
    const tenant = value.tenant;
    if (!isRecord(tenant) ||
      !["tenantId", "slug", "name", "createdAt", "planKey"].every((key) => typeof tenant[key] === "string") ||
      !["userId", "email", "subscriptionStatus"].every((key) => tenant[key] === null || typeof tenant[key] === "string") ||
      !["postsRead", "estimatedUsd", "creditLimit"].every((key) => typeof tenant[key] === "number") ||
      (tenant.grantPlanKey != null && typeof tenant.grantPlanKey !== "string") ||
      (tenant.manualGrant !== undefined && typeof tenant.manualGrant !== "boolean")) return false;
  }
  return value.recent === undefined || (Array.isArray(value.recent) && value.recent.every((row: unknown) =>
    isRecord(row) &&
    ["id", "at", "method", "path"].every((key) => typeof row[key] === "string") &&
    ["status", "postsRead", "estimatedUsd"].every((key) => typeof row[key] === "number") &&
    (row.error === null || typeof row.error === "string") &&
    (row.activity === undefined || typeof row.activity === "string") &&
    (row.credits === undefined || typeof row.credits === "number") &&
    (row.remaining == null || typeof row.remaining === "number")));
}

export function AdminPanel(props: {
  tenants: AdminTenantRow[] | null;
  busy: boolean;
  error: string;
  onBack: () => void;
  onRefresh: () => void;
  onPreviewOnboarding: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logWindow, setLogWindow] = useState<UsageWindow>("7d");
  const [logs, setLogs] = useState<AdminTenantUsageResponse | null>(null);
  const [logsBusy, setLogsBusy] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [grantHandle, setGrantHandle] = useState("");
  const [grantPlan, setGrantPlan] = useState<"pulse" | "radar" | "horizon" | "free">(
    "pulse",
  );
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantNotice, setGrantNotice] = useState("");
  const logsRequestSeqRef = useRef(0);

  const selected = props.tenants?.find((t) => t.tenantId === selectedId) ?? null;

  async function loadTenantLogs(
    tenantId: string,
    window: UsageWindow = logWindow,
  ) {
    const seq = ++logsRequestSeqRef.current;
    setLogsBusy(true);
    setLogsError("");
    try {
      const res = await apiFetch(
        `/api/admin/tenants/${encodeURIComponent(tenantId)}/usage?window=${encodeURIComponent(window)}`,
      );
      const raw: unknown = await res.json();
      const data = isAdminTenantUsageResponse(raw) ? raw : {};
      if (seq !== logsRequestSeqRef.current) return;
      if (!res.ok || !isAdminTenantUsageResponse(raw)) {
        setLogs(null);
        setLogsError(data.message || data.error || `Logs failed (${res.status})`);
        return;
      }
      setLogs(data);
    } catch (err) {
      if (seq !== logsRequestSeqRef.current) return;
      setLogs(null);
      setLogsError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === logsRequestSeqRef.current) setLogsBusy(false);
    }
  }

  function openTenant(tenantId: string) {
    setSelectedId(tenantId);
    setLogs(null);
    setLogsError("");
    loadTenantLogs(tenantId, logWindow).catch((err) => setLogsError(err instanceof Error ? err.message : String(err)));
  }

  function backToList() {
    setSelectedId(null);
    setLogs(null);
    setLogsError("");
  }

  function planLabel(row: AdminTenantRow): string {
    if (row.manualGrant) return `${row.planKey} · granted`;
    if (row.subscriptionStatus) return `${row.planKey} · ${row.subscriptionStatus}`;
    return row.planKey;
  }

  async function onGrant() {
    try {
      const who = grantHandle.trim();
      if (!who) {
        setGrantNotice("Pass an X handle or an email.");
        return;
      }
      setGrantBusy(true);
      setGrantNotice("");
      const looksEmail = who.includes("@") && !who.startsWith("@");
      const res = await apiFetch("/api/admin/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: grantPlan,
          ...(looksEmail ? { email: who } : { handle: who }),
        }),
      });
      const raw: unknown = await res.json();
      const data = isRecord(raw) ? raw : {};
      const message = typeof data.message === "string" ? data.message : undefined;
      const error = typeof data.error === "string" ? data.error : undefined;
      const notice = typeof data.notice === "string" ? data.notice : undefined;
      const grantNotice = isRecord(data.grant) && typeof data.grant.notice === "string" ? data.grant.notice : undefined;
      const planKey = typeof data.plan_key === "string" ? data.plan_key : undefined;
      if (!res.ok || !data.ok) {
        setGrantNotice(message || error || `Grant failed (${res.status})`);
        return;
      }
      setGrantNotice(
        notice ||
          grantNotice ||
          `Granted ${planKey ?? grantPlan}.`,
      );
      props.onRefresh();
    } catch (err) {
      setGrantNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setGrantBusy(false);
    }
  }

  return (
    <section className="panel settings-pane usage-pane">
      <div className="settings-head">
        <h2>Admin</h2>
        <div className="admin-head-actions">
          <button
            type="button"
            className="ghost"
            onClick={props.onPreviewOnboarding}
          >
            Preview onboarding
          </button>
          <button type="button" className="ghost" onClick={props.onBack}>
            Back
          </button>
        </div>
      </div>
      <p className="status settings-lede">
        Per-tenant X post reads this UTC month, estimated platform spend, and
        full request logs. Shared credentials; each desk has its own credit
        pool. Grant a complimentary plan without Stripe — they will see a
        notice that the account was manually upgraded.
      </p>
      {!selected ? (
        <div className="admin-grant">
          <label className="settings-field">
            <span>Handle or email</span>
            <input
              type="text"
              value={grantHandle}
              placeholder="@handle or email"
              autoComplete="off"
              onChange={(e) => setGrantHandle(e.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>Plan</span>
            <select
              className="settings-select"
              value={grantPlan}
              onChange={(e) => {
                const next = e.target.value;
                if (isOneOf(next, ["pulse", "radar", "horizon", "free"])) setGrantPlan(next);
              }}
            >
              <option value="pulse">Pulse</option>
              <option value="radar">Radar</option>
              <option value="horizon">Horizon</option>
              <option value="free">Clear grant (Free)</option>
            </select>
          </label>
          <button
            type="button"
            className="primary"
            disabled={grantBusy || props.busy}
            onClick={() => { onGrant().catch((err) => setGrantNotice(err instanceof Error ? err.message : String(err))); }}
          >
            {grantBusy ? "Granting…" : "Grant plan"}
          </button>
          {grantNotice ? (
            <p className="usage-banner" role="status">
              {grantNotice}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="usage-toolbar">
        {selected ? (
          <button type="button" className="ghost" onClick={backToList}>
            All tenants
          </button>
        ) : null}
        <button
          type="button"
          className="ghost"
          disabled={props.busy || logsBusy}
          onClick={() => {
            props.onRefresh();
            if (selectedId) loadTenantLogs(selectedId, logWindow).catch((err) => setLogsError(err instanceof Error ? err.message : String(err)));
          }}
        >
          {props.busy || logsBusy ? "Loading…" : "Refresh"}
        </button>
      </div>
      {props.error ? <p className="status danger">{props.error}</p> : null}
      {selected ? (
        <>
          <div className="usage-stats usage-stats-3">
            <div className="usage-stat">
              <span className="usage-stat-label">Tenant</span>
              <strong className="usage-stat-value">
                <code>{selected.slug}</code>
              </strong>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-label">Reads / limit</span>
              <strong className="usage-stat-value">
                {selected.postsRead.toLocaleString()} /{" "}
                {selected.creditLimit.toLocaleString()}
              </strong>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-label">Est. spend</span>
              <strong className="usage-stat-value">
                ${selected.estimatedUsd.toFixed(3)}
              </strong>
            </div>
          </div>
          <p className="settings-help">
            {selected.email ?? "No email"} · {planLabel(selected)}
          </p>
          {selected.manualGrant ? (
            <p className="usage-banner" role="status">
              This account was manually upgraded
              {selected.grantPlanKey ? ` to ${selected.grantPlanKey}` : ""}{" "}
              without a Stripe subscription.
            </p>
          ) : null}
          <div className="usage-toolbar">
            <label className="settings-field usage-window">
              <span>Window</span>
              <select
                className="settings-select"
                value={logWindow}
                disabled={logsBusy}
                onChange={(e) => {
                  const next = e.target.value;
                  if (!isOneOf(next, ["24h", "7d", "all"])) return;
                  setLogWindow(next);
                  loadTenantLogs(selected.tenantId, next).catch((err) => setLogsError(err instanceof Error ? err.message : String(err)));
                }}
              >
                <option value="24h">Last 24h</option>
                <option value="7d">Last 7 days</option>
                <option value="all">All time</option>
              </select>
            </label>
          </div>
          {logsError ? <p className="status danger">{logsError}</p> : null}
          <h3 className="usage-log-title">Request logs</h3>
          {(logs?.recent?.length ?? 0) === 0 ? (
            <p className="status">
              {logsBusy
                ? "Loading logs…"
                : "No X API calls recorded in this window yet."}
            </p>
          ) : (
            <div className="usage-log">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Path</th>
                    <th>Status</th>
                    <th>Credits</th>
                    <th>Est. $</th>
                  </tr>
                </thead>
                <tbody>
                  {(logs?.recent ?? []).map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.at).toLocaleString()}</td>
                      <td className="usage-path">
                        <code>{row.path}</code>
                        {row.error ? (
                          <span className="usage-error"> {row.error}</span>
                        ) : null}
                      </td>
                      <td>{row.status}</td>
                      <td>{row.credits ?? row.postsRead}</td>
                      <td>${row.estimatedUsd.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : props.tenants ? (
        <div className="usage-log">
          <table>
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Email</th>
                <th>Plan</th>
                <th>Reads</th>
                <th>Est. $</th>
              </tr>
            </thead>
            <tbody>
              {props.tenants.length === 0 ? (
                <tr>
                  <td colSpan={5}>No tenants yet.</td>
                </tr>
              ) : (
                props.tenants.map((row) => (
                  <tr
                    key={row.tenantId}
                    className="admin-tenant-row"
                    onClick={() => openTenant(row.tenantId)}
                  >
                    <td>
                      <code>{row.slug}</code>
                      <div className="usage-error">{row.name}</div>
                    </td>
                    <td>{row.email ?? "—"}</td>
                    <td>{planLabel(row)}</td>
                    <td>
                      {row.postsRead.toLocaleString()} /{" "}
                      {row.creditLimit.toLocaleString()}
                    </td>
                    <td>${row.estimatedUsd.toFixed(3)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
