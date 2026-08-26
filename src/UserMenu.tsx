import { useId, useState } from "react";
import { menuAvatarUrl, menuInitials } from "./lib/menuProfile";
import type { Theme } from "./lib/theme";

type MenuUser = {
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  xUsername: string | null;
};

type MenuView =
  | "home"
  | "dashboard"
  | "voice"
  | "settings"
  | "account"
  | "usage"
  | "admin"
  | "analytics"
  | "pricing"
  | "changelog"
  | "learn"
  | "learnWeights"
  | "learnReply"
  | "learnFollow"
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

/** Deterministic HSL tiles for the guest plane — same seed, same mark. */
function guestTileColors(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hue = 198 + next() * 26;
  return {
    ink: `hsl(${(hue - 8).toFixed(1)} 28% 18%)`,
    tile: `hsl(${hue.toFixed(1)} 44% 42%)`,
    tileHi: `hsl(${(hue + 16).toFixed(1)} 38% 58%)`,
    edge: `hsl(${(hue + 8).toFixed(1)} 32% 72%)`,
  };
}

const GUEST_TILES = guestTileColors(0x5eed);

export function GuestAvatar() {
  const uid = useId().replace(/:/g, "");
  const tileId = `guest-tile-${uid}`;
  const clipId = `guest-plane-${uid}`;

  return (
    <span className="menu-avatar menu-avatar-guest" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="32" height="32" focusable="false">
        <defs>
          <pattern
            id={tileId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill={GUEST_TILES.ink} />
            <rect width="3" height="3" fill={GUEST_TILES.tile} />
            <rect x="3" y="3" width="3" height="3" fill={GUEST_TILES.tileHi} />
          </pattern>
          <clipPath id={clipId}>
            <path d="M4 16 L27.5 7 L18 16 L27.5 25 Z" />
          </clipPath>
        </defs>
        <rect width="32" height="32" fill={GUEST_TILES.ink} />
        <g clipPath={`url(#${clipId})`}>
          <rect width="32" height="32" fill={`url(#${tileId})`} />
        </g>
        <path
          d="M4 16 L27.5 7 L18 16 L27.5 25 Z"
          fill="none"
          stroke={GUEST_TILES.edge}
          strokeWidth="0.85"
          strokeLinejoin="miter"
        />
        <path
          d="M18 16 L9 16"
          fill="none"
          stroke={GUEST_TILES.edge}
          strokeWidth="0.7"
          strokeLinecap="square"
          opacity="0.75"
        />
      </svg>
    </span>
  );
}

export function HeaderAvatar({
  user,
  handle,
}: {
  user: MenuUser | null;
  handle: string | null;
}) {
  const src = menuAvatarUrl(user?.avatarUrl);
  const [broken, setBroken] = useState(false);
  const initials = menuInitials(user?.displayName, user?.email, handle);

  if (!user) return <GuestAvatar />;

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
  needsLogin: boolean;
  needsOnboarding: boolean;
  onTheme: () => void;
  onLogout: () => void;
  onX: () => void;
  onSignIn: () => void;
  onDesk: () => void;
  onAnalytics: () => void;
  onVoice: () => void;
  needsXLink?: boolean;
  onUsage: () => void;
  onAccount: () => void;
  onSettings: () => void;
  onPrivacySettings: () => void;
}) {
  const handle = props.authUser?.xUsername || null;
  const name =
    props.authUser?.displayName ||
    props.authUser?.email ||
    (handle ? `@${handle}` : null);

  return (
    <>
      <div className="menu-profile">
        <HeaderAvatar user={props.authUser} handle={handle} />
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
                <p className="menu-profile-handle">X handle not set</p>
              )}
            </>
          ) : (
            <>
              <p className="menu-profile-name">Not signed in</p>
              {props.needsLogin ? null : (
                <p className="menu-profile-email">
                  Sign in with Google or X. X is identity-only until you post
                  from the desk.
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
        {props.authUser ? null : (
          <button type="button" className="menu-item" onClick={props.onSignIn}>
            <MenuIcon d="M10 7V5h10v14H10v-2M4 12h11M8 8l-4 4 4 4" />
            Sign in
          </button>
        )}

        {props.needsLogin || props.needsOnboarding ? null : (
          <>
            <p className="menu-group-label">Desk</p>
            <button
              type="button"
              className={
                props.view === "dashboard" ? "menu-item is-current" : "menu-item"
              }
              onClick={props.onDesk}
            >
              <MenuIcon d="M4 6h16v12H4zM8 10h8M8 14h5" />
              Desk
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
            {props.needsXLink ? (
              <button
                type="button"
                className="menu-item"
                onClick={props.onX}
                title="Voice needs your X account so we can read your public posts."
              >
                <MenuIcon d="M4 4h16v16H4zM8 12h8M12 8v8" />
                Link X
              </button>
            ) : (
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
            )}
            <button
              type="button"
              className={
                props.view === "account" ? "menu-item is-current" : "menu-item"
              }
              onClick={props.onAccount}
            >
              <MenuIcon d="M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM4 20c1.6-3.2 4.2-5 8-5s6.4 1.8 8 5" />
              Account
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
          className={props.view === "pricing" ? "menu-item is-current" : "menu-item"}
          href="/pricing"
        >
          <MenuIcon d="M4 7h16v3H4zM4 14h7v6H4zM13 14h7v6h-7z" />
          Pricing
        </a>
        <a
          className={
            props.view === "changelog" ? "menu-item is-current" : "menu-item"
          }
          href="/changelog"
        >
          <MenuIcon d="M5 6h14v3H5zM5 12h14v3H5zM5 18h9v3H5z" />
          Changelog
        </a>
        <a
          className={
            props.view === "learn" ||
            props.view === "learnWeights" ||
            props.view === "learnReply" ||
            props.view === "learnFollow"
              ? "menu-item is-current"
              : "menu-item"
          }
          href="/learn"
        >
          <MenuIcon d="M5 5h14v4H5zM5 11h10v8H5zM17 11h2v8h-2z" />
          Learn
        </a>
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
