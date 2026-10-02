import type { ReactNode } from "react";
import { browser } from "wxt/browser";
import { DEFAULT_DESK_ORIGIN } from "../../lib/desks";

export function openDeskPage(path: string): void {
  browser.tabs.create({ url: `${DEFAULT_DESK_ORIGIN}${path}` }).catch(() => undefined);
}

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" fill="#0a0c0f" />
      <g fill="none" stroke="#5b9fd4" strokeWidth="2" strokeLinecap="square">
        <path d="M9 13V9h4" />
        <path d="M19 9h4v4" />
        <path d="M23 19v4h-4" />
        <path d="M13 23H9v-4" />
      </g>
      <circle cx="16" cy="16" r="2" fill="#5b9fd4" />
    </svg>
  );
}

export function PanelHeader({ connected, children }: { connected: boolean | null; children?: ReactNode }) {
  return (
    <header className="panel-head">
      <div className="brand-lockup">
        <BrandMark />
        <span className="brand-name">x-copilot</span>
      </div>
      <div className="panel-head-side">
        {connected === null ? null : (
          <span className={`status-chip${connected ? " is-on" : ""}`}>
            <span className="status-dot" aria-hidden="true" />
            {connected ? "Connected" : "Not connected"}
          </span>
        )}
        {children}
      </div>
    </header>
  );
}

export type PanelLink = { label: string; path: string };

export const DESK_LINKS: readonly PanelLink[] = [
  { label: "Open desk", path: "/dashboard" },
  { label: "Learn", path: "/learn" },
];

export const FOOTER_LINKS: readonly PanelLink[] = [
  { label: "Open desk", path: "/dashboard" },
  { label: "Account", path: "/account" },
];

export function PanelLinks({ links }: { links: readonly PanelLink[] }) {
  return (
    <nav className="panel-links" aria-label="X Copilot desk">
      {links.map((link) => (
        <button key={link.path} type="button" className="ghost" onClick={() => openDeskPage(link.path)}>
          {link.label}
        </button>
      ))}
    </nav>
  );
}

export function PanelShell({
  connected,
  headSide,
  children,
}: {
  connected: boolean | null;
  headSide?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="panel">
      <PanelHeader connected={connected}>{headSide}</PanelHeader>
      {children}
    </main>
  );
}
