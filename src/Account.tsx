import { useEffect, useState } from "react";
import { apiFetch } from "./lib/apiBase";
import { menuAvatarUrl, menuInitials } from "./lib/menuProfile";

type PublicSession = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  browser: string;
  os: string;
  current: boolean;
};

type LinkedProvider = {
  provider: "google" | "x";
  username: string | null;
  email: string | null;
};

type AccountUser = {
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  xUsername: string | null;
  xCanPost?: boolean;
};

type AccountPayload = {
  ok?: boolean;
  user?: AccountUser;
  mail?: {
    digestEmailOptIn?: boolean;
    digestEmailAvailable?: boolean;
  };
  providers?: LinkedProvider[];
  sessions?: PublicSession[];
  error?: string;
  message?: string;
};

function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleString();
}

function providerLabel(row: LinkedProvider): string {
  if (row.provider === "x") {
    const handle = (row.username ?? "").replace(/^@/, "");
    return handle ? `@${handle}` : "Linked";
  }
  return row.email || "Linked";
}

export function Account(props: {
  onBack: () => void;
  onGoogle: () => void;
  onX: () => void;
  onSignedOut: () => void;
}) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [providers, setProviders] = useState<LinkedProvider[]>([]);
  const [sessions, setSessions] = useState<PublicSession[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingOthers, setPendingOthers] = useState(false);
  const [acting, setActing] = useState(false);
  const [digestEmailOptIn, setDigestEmailOptIn] = useState(false);
  const [digestEmailAvailable, setDigestEmailAvailable] = useState(false);
  const [savingDigestEmail, setSavingDigestEmail] = useState(false);

  async function load() {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("/api/auth/account");
      const data = (await res.json()) as AccountPayload;
      if (res.status === 401) {
        props.onSignedOut();
        return;
      }
      if (!res.ok || !data.ok) {
        setError(data.message || data.error || `Account failed (${res.status})`);
        return;
      }
      setUser(data.user ?? null);
      setDigestEmailOptIn(data.mail?.digestEmailOptIn === true);
      setDigestEmailAvailable(data.mail?.digestEmailAvailable === true);
      setProviders(data.providers ?? []);
      setSessions(data.sessions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateDigestEmail(optedIn: boolean) {
    setSavingDigestEmail(true);
    setError("");
    try {
      const res = await apiFetch("/api/mail/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digestEmailOptIn: optedIn }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        digestEmailOptIn?: boolean;
        digestEmailAvailable?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(
          data.message ||
            data.error ||
            `Email preference failed (${res.status})`,
        );
        return;
      }
      setDigestEmailOptIn(data.digestEmailOptIn === true);
      setDigestEmailAvailable(data.digestEmailAvailable === true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingDigestEmail(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function revokeOne(id: string) {
    setActing(true);
    setError("");
    try {
      const res = await apiFetch(`/api/auth/sessions/${id}`, { method: "DELETE" });
      const data = (await res.json()) as AccountPayload & {
        signedOut?: boolean;
      };
      if (res.status === 401) {
        props.onSignedOut();
        return;
      }
      if (!res.ok) {
        setError(data.message || data.error || `Revoke failed (${res.status})`);
        setPendingId(null);
        return;
      }
      if (data.signedOut) {
        props.onSignedOut();
        return;
      }
      setSessions(data.sessions ?? []);
      setPendingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPendingId(null);
    } finally {
      setActing(false);
    }
  }

  async function revokeOthers() {
    setActing(true);
    setError("");
    try {
      const res = await apiFetch("/api/auth/sessions/revoke-others", {
        method: "POST",
      });
      const data = (await res.json()) as AccountPayload;
      if (res.status === 401) {
        props.onSignedOut();
        return;
      }
      if (!res.ok) {
        setError(data.message || data.error || `Revoke failed (${res.status})`);
        setPendingOthers(false);
        return;
      }
      setSessions(data.sessions ?? []);
      setPendingOthers(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPendingOthers(false);
    } finally {
      setActing(false);
    }
  }

  const handle = user?.xUsername || null;
  const name = user?.displayName || user?.email || (handle ? `@${handle}` : "Account");
  const avatar = menuAvatarUrl(user?.avatarUrl);
  const initials = menuInitials(user?.displayName, user?.email, handle);
  const hasGoogle = providers.some((p) => p.provider === "google");
  const hasX = providers.some((p) => p.provider === "x");
  const google = providers.find((p) => p.provider === "google");
  const x = providers.find((p) => p.provider === "x");

  return (
    <section className="panel settings-pane account-pane">
      <div className="settings-head">
        <h2>Account</h2>
        <div className="account-head-actions">
          <button type="button" className="ghost" disabled={busy} onClick={() => void load()}>
            {busy ? "Loading…" : "Refresh"}
          </button>
          <button type="button" className="ghost" onClick={props.onBack}>
            Back
          </button>
        </div>
      </div>
      <p className="status settings-lede">
        Profile, linked sign-in, and devices. Settings stays Scout filters.
        Usage & Billing stays billing.
      </p>
      <p
        className={error ? "status danger account-alert" : "account-alert"}
        role="status"
        aria-live="polite"
      >
        {error || "\u00a0"}
      </p>

      <div className="account-profile">
        {avatar ? (
          <img className="account-avatar" src={avatar} alt="" />
        ) : (
          <span className="account-avatar account-avatar-fallback" aria-hidden>
            {initials}
          </span>
        )}
        <div className="account-profile-meta">
          <p className="account-profile-name">{name}</p>
          {user?.email && user.email !== name ? (
            <p className="account-profile-email">{user.email}</p>
          ) : null}
          {handle ? (
            <p className="account-profile-email">@{handle}</p>
          ) : null}
        </div>
      </div>

      <h3 className="account-section-title">Linked sign-in</h3>
      <ul className="account-providers">
        <li className="account-provider">
          <div>
            <strong>Google</strong>
            <p className="settings-help">
              {hasGoogle && google ? providerLabel(google) : "Not linked"}
            </p>
          </div>
          <div className="account-row-action">
            {hasGoogle ? null : (
              <button type="button" className="ghost" onClick={props.onGoogle}>
                Link Google
              </button>
            )}
          </div>
        </li>
        <li className="account-provider">
          <div>
            <strong>X</strong>
            <p className="settings-help">
              {hasX && x ? providerLabel(x) : "Not linked"}
            </p>
          </div>
          <div className="account-row-action">
            <button type="button" className="ghost" onClick={props.onX}>
              {hasX ? "Switch X" : "Link X"}
            </button>
          </div>
        </li>
      </ul>

      <h3 className="account-section-title">Approach email</h3>
      <div className="account-mail">
        <div className="account-mail-copy">
          <strong>Daily digest ready</strong>
          <p className="settings-help">
            {digestEmailAvailable
              ? `Email ${user?.email ?? "your verified address"} only when a new Approach is ready.`
              : "Digest needs a verified email. Link Google to opt in."}
          </p>
        </div>
        <div className="account-row-action">
          {digestEmailAvailable ? (
            <label className="account-mail-toggle">
              <input
                type="checkbox"
                checked={digestEmailOptIn}
                disabled={busy || savingDigestEmail}
                onChange={(event) =>
                  void updateDigestEmail(event.currentTarget.checked)
                }
              />
              <span aria-live="polite">
                {savingDigestEmail ? "Saving…" : digestEmailOptIn ? "On" : "Off"}
              </span>
            </label>
          ) : (
            <button type="button" className="ghost" onClick={props.onGoogle}>
              Link Google
            </button>
          )}
        </div>
      </div>

      <h3 className="account-section-title">Sessions</h3>
      {busy && sessions.length === 0 ? (
        <p className="status">Loading sessions…</p>
      ) : sessions.length === 0 ? (
        <p className="status">No active sessions.</p>
      ) : (
        <ul className="account-sessions">
          {sessions.map((row) => (
            <li key={row.id} className="account-session">
              <div className="account-session-top">
                <div className="account-session-copy">
                  <p className="account-session-agent">
                    {row.browser} · {row.os}
                    {row.current ? (
                      <span className="account-badge">This device</span>
                    ) : null}
                  </p>
                  <p className="account-session-meta">
                    {row.ip || "—"}
                    <span aria-hidden> · </span>
                    Created {formatWhen(row.createdAt)}
                    <span aria-hidden> · </span>
                    Last seen {formatWhen(row.lastSeenAt)}
                  </p>
                </div>
                <div className="account-row-action">
                  {pendingId === row.id ? (
                    <div className="account-confirm">
                      <span>Revoke?</span>
                      <button
                        type="button"
                        className="ghost"
                        disabled={acting}
                        onClick={() => void revokeOne(row.id)}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={acting}
                        onClick={() => setPendingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="ghost"
                      disabled={acting}
                      onClick={() => {
                        setPendingOthers(false);
                        setPendingId(row.id);
                      }}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="account-footer">
        <div className="account-footer-action">
          {pendingOthers ? (
            <div className="account-confirm">
              <span>Sign out others?</span>
              <button
                type="button"
                className="ghost"
                disabled={acting}
                onClick={() => void revokeOthers()}
              >
                Confirm
              </button>
              <button
                type="button"
                className="ghost"
                disabled={acting}
                onClick={() => setPendingOthers(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="ghost"
              disabled={acting || sessions.length <= 1}
              onClick={() => {
                setPendingId(null);
                setPendingOthers(true);
              }}
            >
              Sign out other sessions
            </button>
          )}
        </div>
        <p className="settings-help">
          Other devices are signed out on their next request.
        </p>
      </div>
    </section>
  );
}
