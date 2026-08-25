import { BillingPanel, type BillingMe, type PaidPlanKey } from "../BillingPanel";
import type { UsageSummaryResponse, UsageWindow } from "./types";

type UsagePageProps = {
  usageWindow: UsageWindow;
  usage: UsageSummaryResponse | null;
  busy: boolean;
  status: string;
  billing: BillingMe | null;
  billingNotice: string;
  checkoutPlan: PaidPlanKey | null;
  portalBusy: boolean;
  onBack: () => void;
  onLoad: (window: UsageWindow) => void;
  onWindowChange: (window: UsageWindow) => void;
  onSubscribe: (plan: PaidPlanKey) => void;
  onManageBilling: () => void;
};

export function UsagePage({
  usageWindow,
  usage,
  busy,
  status,
  billing,
  billingNotice,
  checkoutPlan,
  portalBusy,
  onBack,
  onLoad,
  onWindowChange,
  onSubscribe,
  onManageBilling,
}: UsagePageProps) {
  return (
    <section className="panel settings-pane usage-pane">
      <div className="settings-head">
        <h2>Usage & Billing</h2>
        <button type="button" className="ghost" onClick={onBack}>
          Back
        </button>
      </div>
      <p className="status settings-lede">
        {billing?.first_week_pulse
          ? "First week is a Pulse week. Then Free — 1,500 credits a month, no credit card. "
          : ""}
        Unused credits do not roll over. Paid plans are billed by
        Mergestorm, Inc.
      </p>
      <BillingPanel
        billing={billing}
        busy={busy}
        notice={billingNotice}
        checkoutPlan={checkoutPlan}
        portalBusy={portalBusy}
        onSubscribe={onSubscribe}
        onManage={onManageBilling}
      />
      <div className="usage-toolbar">
        <label className="settings-field usage-window">
          <span>Window</span>
          <select
            className="settings-select"
            value={usageWindow}
            disabled={busy}
            onChange={(e) => onWindowChange(e.target.value as UsageWindow)}
          >
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7 days</option>
            <option value="all">All time</option>
          </select>
        </label>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => onLoad(usageWindow)}
        >
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>
      {status ? <p className="status danger">{status}</p> : null}
      {usage?.creditsDepletedRecent ? (
        <p className="usage-banner">
          Scout could not finish — a platform read limit was hit. Try again
          shortly.
        </p>
      ) : null}
      {usage ? (
        <>
          <div className="usage-stats usage-stats-3">
            <div className="usage-stat">
              <span className="usage-stat-label">Credits used</span>
              <strong className="usage-stat-value">{usage.creditsUsed ?? 0}</strong>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-label">Remaining</span>
              <strong className="usage-stat-value">{usage.remaining ?? 0}</strong>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-label">Calls</span>
              <strong className="usage-stat-value">{usage.calls ?? 0}</strong>
            </div>
          </div>
          <p className="settings-help">{usage.note}</p>
          <h3 className="usage-log-title">Usage logs</h3>
          {(usage.recent?.length ?? 0) === 0 ? (
            <p className="status">No usage recorded in this window yet.</p>
          ) : (
            <div className="usage-log">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Activity</th>
                    <th>Credits</th>
                    <th>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {(usage.recent ?? []).map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.at).toLocaleString()}</td>
                      <td>
                        {row.activity}
                        {row.error ? (
                          <span className="usage-error"> {row.error}</span>
                        ) : null}
                      </td>
                      <td>{row.credits}</td>
                      <td>
                        {row.remaining === null || row.remaining === undefined
                          ? "—"
                          : row.remaining}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
