export type AdminTenantRow = {
  tenantId: string;
  slug: string;
  name: string;
  createdAt: string;
  userId: string | null;
  email: string | null;
  planKey: string;
  subscriptionStatus: string | null;
  postsRead: number;
  estimatedUsd: number;
  creditLimit: number;
};

export function AdminPanel(props: {
  tenants: AdminTenantRow[] | null;
  busy: boolean;
  error: string;
  onBack: () => void;
  onRefresh: () => void;
}) {
  return (
    <section className="panel settings-pane usage-pane">
      <div className="settings-head">
        <h2>Admin</h2>
        <button type="button" className="ghost" onClick={props.onBack}>
          Back
        </button>
      </div>
      <p className="status settings-lede">
        Per-tenant X post reads this UTC month. Shared platform credentials;
        each desk has its own credit pool.
      </p>
      <div className="usage-toolbar">
        <button
          type="button"
          className="ghost"
          disabled={props.busy}
          onClick={props.onRefresh}
        >
          {props.busy ? "Loading…" : "Refresh"}
        </button>
      </div>
      {props.error ? <p className="status danger">{props.error}</p> : null}
      {props.tenants ? (
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
                  <tr key={row.tenantId}>
                    <td>
                      <code>{row.slug}</code>
                      <div className="usage-error">{row.name}</div>
                    </td>
                    <td>{row.email ?? "—"}</td>
                    <td>
                      {row.planKey}
                      {row.subscriptionStatus
                        ? ` · ${row.subscriptionStatus}`
                        : ""}
                    </td>
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
