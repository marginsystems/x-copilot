import type { AuthSessionUser } from "../auth/types";
import { HeaderAvatar } from "../UserMenu";

type AppHeaderProps = {
  gate: boolean;
  menuOpen: boolean;
  menuEntered: boolean;
  authUser: AuthSessionUser | null;
  onHome: () => void;
  onToggleMenu: () => void;
};

export function AppHeader({
  gate,
  menuOpen,
  menuEntered,
  authUser,
  onHome,
  onToggleMenu,
}: AppHeaderProps) {
  return (
    <header className={gate ? "brand brand-gate" : "brand"}>
      <div className="brand-bar">
        <a
          className="brand-lockup"
          href="/"
          aria-label="Home"
          onClick={(e) => {
            if (
              e.metaKey ||
              e.ctrlKey ||
              e.shiftKey ||
              e.altKey ||
              e.button !== 0
            ) {
              return;
            }
            e.preventDefault();
            onHome();
          }}
        >
          <img
            className="brand-mark"
            src="/favicon.svg"
            width={22}
            height={22}
            alt=""
          />
          <div className="brand-copy">
            <h1>x-copilot</h1>
          </div>
        </a>
        <button
          type="button"
          className={
            menuOpen && menuEntered
              ? "menu-toggle is-open"
              : "menu-toggle is-avatar"
          }
          aria-label={menuOpen && menuEntered ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen && menuEntered}
          onClick={onToggleMenu}
        >
          {menuOpen && menuEntered ? (
            <svg
              className="menu-toggle-icon"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              aria-hidden="true"
            >
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="square"
              />
            </svg>
          ) : (
            <HeaderAvatar
              user={authUser}
              handle={authUser?.xUsername ?? null}
            />
          )}
        </button>
      </div>
    </header>
  );
}
