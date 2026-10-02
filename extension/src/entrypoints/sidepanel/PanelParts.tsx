import type { ReactNode } from "react";
import { browser } from "wxt/browser";
import { DEFAULT_DESK_ORIGIN } from "../../lib/desks";

export function openDeskPage(path: string): void {
  browser.tabs.create({ url: `${DEFAULT_DESK_ORIGIN}${path}` }).catch(() => undefined);
}

export function PanelHeader({ connected, children }: { connected: boolean | null; children?: ReactNode }) {
  if (connected === null) return null;
  return (
    <header className="panel-head">
      <span className={`status-chip${connected ? " is-on" : ""}`}>
        <span className="status-dot" aria-hidden="true" />
        {connected ? "Connected" : "Not connected"}
      </span>
      {children ? <div className="panel-head-side">{children}</div> : null}
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
