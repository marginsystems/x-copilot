import { useEffect, useRef, useState, type ReactNode } from "react";
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

export const CARD_SLIDE_OUT_MS = 380;

export function CardSlide({ slideKey, children }: { slideKey: string; children: ReactNode }) {
  const [current, setCurrent] = useState({ key: slideKey, moved: false });
  const [leaving, setLeaving] = useState<{ key: string; node: ReactNode } | null>(null);
  const lastNode = useRef<ReactNode>(children);

  if (current.key !== slideKey) {
    setLeaving({ key: current.key, node: lastNode.current });
    setCurrent({ key: slideKey, moved: true });
  }

  useEffect(() => {
    lastNode.current = children;
  });

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(null), CARD_SLIDE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  return (
    <div className="card-slide">
      <div key={slideKey} className={`card-slide-item${current.moved ? " is-entering" : ""}`}>
        {children}
      </div>
      {leaving ? (
        <div key={`out:${leaving.key}`} className="card-slide-item is-leaving" aria-hidden="true" {...{ inert: "" }}>
          {leaving.node}
        </div>
      ) : null}
    </div>
  );
}

export function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
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
