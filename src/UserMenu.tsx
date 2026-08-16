import { useState } from "react";
import { AuthButtons } from "./AuthButtons";
import { menuAvatarUrl, menuInitials } from "./lib/menuProfile";
import type { Theme } from "./lib/theme";

type MenuUser = {
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  xUsername: string | null;
};

type MenuView =
  | "dashboard"
  | "voice"
  | "settings"
  | "usage"
  | "admin"
  | "analytics"
  | "privacy"
  | "terms";

function MenuIcon({ d }: { d: string }) {
  return (
    <svg
      className="menu-item-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

function MenuAvatar({
  user,
  handle,
}: {
  user: MenuUser | null;
  handle: string | null;
}) {
  const src = menuAvatarUrl(user?.avatarUrl);
  const [broken, setBroken] = useState(false);
  const initials = menuInitials(user?.displayName, user?.email, handle);

  if (src && !broken) {
    return (
      <span className="menu-avatar">
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      </span>
    );
  }

  return (
    <span className="menu-avatar menu-avatar-fallback" aria-hidden="true">
      {initials}
    </span>
  );
}

export function UserMenu(props: {
  view: MenuView;
  theme: Theme;
  authUser: MenuUser | null;
  sessionHandle: string | null;
  needsLogin: boolean;
  needsOnboarding: boolean;
  actionBusy: boolean;
  onTheme: () => void;
  onLogout: () => void;
  onGoogle: () => void;
  onX: () => void;
  onVerify: () => void;
  onAnalytics: () => void;
  onVoice: () => void;
  onUsage: () => void;
  onSettings: () => void;
  onPrivacySettings: () => void;
}) {
  const handle =
    props.authUser?.xUsername || props.sessionHandle || null;
  const name =
    props.authUser?.displayName ||
    props.authUser?.email ||
    (handle ? `@${handle}` : null);

  return (
    <>
      <div className="menu-profile">
        <MenuAvatar user={props.authUser} handle={handle} />
        <div className="menu-profile-meta">
          {props.authUser ? (
            <>
              <p className="menu-profile-name">{name}</p>
              {props.authUser.email && props.authUser.email !== name ? (
                <p className="menu-profile-email">{props.authUser.email}</p>
              ) : null}
              {handle ? (
                <p className="menu-profile-handle">@{handle}</p>
              ) : props.needsLogin || props.needsOnboarding ? null : (
                <p className="menu-profile-handle">X API not verified</p>
              )}
            </>
          ) : (
            <>
              <p className="menu-profile-name">Not signed in</p>
              {props.needsLogin ? null : (
                <p className="menu-profile-email">
                  Sign in with Google or X. X is identity-only.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="menu-theme">
        <div className="menu-theme-copy">
          <p className="menu-theme-label">Appearance</p>
          <p className="menu-theme-value">
            {props.theme === "dark" ? "Dark" : "Light"}
          </p>
        </div>
        <button
          type="button"
          className="menu-switch"
          role="switch"
          aria-checked={props.theme === "light"}
          aria-label={
            props.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
          }
          onClick={props.onTheme}
        >
          <span className="menu-switch-knob" />
        </button>
      </div>

      <nav className="menu-nav" aria-label="User menu">
        {props.authUser || props.needsLogin ? null : (
          <AuthButtons stacked onGoogle={props.onGoogle} onX={props.onX} />
        )}

        {props.needsLogin || props.needsOnboarding ? null : (
          <>
            <p className="menu-group-label">Desk</p>
            <button
              type="button"
              className="menu-item"
              disabled={props.actionBusy}
              onClick={props.onVerify}
            >
              <MenuIcon d="M12 3l8 4v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4zM8.5 12l2.5 2.5 4.5-5" />
              Verify X API
            </button>
            <button
              type="button"
              className={
                props.view === "analytics" ? "menu-item is-current" : "menu-item"
              }
              onClick={props.onAnalytics}
            >
              <MenuIcon d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
              Analytics
            </button>
            <button
              type="button"
              className={
                props.view === "voice" ? "menu-item is-current" : "menu-item"
              }
              onClick={props.onVoice}
            >
              <MenuIcon d="M4 14c2-4 4-6 8-6s6 2 8 6M12 14v6M9 17h6" />
              Voice
            </button>
            <button
              type="button"
              className={
                props.view === "usage" ? "menu-item is-current" : "menu-item"
              }
              onClick={props.onUsage}
            >
              <MenuIcon d="M4 7h16v12H4zM8 7V5h8v2M12 11v5M9 14h6" />
              Usage & Billing
            </button>
            <button
              type="button"
              className={
                props.view === "settings" ? "menu-item is-current" : "menu-item"
              }
              onClick={props.onSettings}
            >
              <MenuIcon d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM12 3v2M12 19v2M4.2 6.2l1.4 1.4M18.4 16.4l1.4 1.4M3 12h2M19 12h2M4.2 17.8l1.4-1.4M18.4 7.6l1.4-1.4" />
              Settings
            </button>
          </>
        )}

        <p className="menu-group-label">Legal</p>
        <a
          className={props.view === "privacy" ? "menu-item is-current" : "menu-item"}
          href="/privacy"
        >
          <MenuIcon d="M12 3l8 4v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z" />
          Privacy
        </a>
        <a
          className={props.view === "terms" ? "menu-item is-current" : "menu-item"}
          href="/terms"
        >
          <MenuIcon d="M7 4h10v16H7zM10 8h4M10 12h4M10 16h3" />
          Terms
        </a>
        <button
          type="button"
          className="menu-item"
          onClick={props.onPrivacySettings}
        >
          <MenuIcon d="M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 20c1.5-3 4-5 8-5s6.5 2 8 5" />
          Privacy settings
        </button>

        {props.authUser ? (
          <button
            type="button"
            className="menu-item menu-item-signout"
            onClick={props.onLogout}
          >
            <MenuIcon d="M10 7V5h10v14H10v-2M4 12h11M8 8l-4 4 4 4" />
            Sign out
          </button>
        ) : null}
      </nav>
    </>
  );
}
