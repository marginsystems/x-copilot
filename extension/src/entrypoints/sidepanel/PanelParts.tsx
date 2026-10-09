import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { browser } from "wxt/browser";
import {
  NEXT_CONFIRM_KEEP_LABEL,
  NEXT_CONFIRM_SKIP_LABEL,
  nextConfirmCopy,
  type NextConfirmSubject,
} from "../../../../shared/src/nextConfirm";
import { DEFAULT_DESK_ORIGIN, DESK_TARGETS } from "../../lib/desks";
import { planOpenDesk } from "../../lib/openDesk";

async function showDeskPage(path: string): Promise<void> {
  const deskOrigins = DESK_TARGETS.map((target) => target.deskOrigin);
  const here = await browser.tabs.query({ currentWindow: true });
  const nearby = planOpenDesk(here, path, deskOrigins, DEFAULT_DESK_ORIGIN);
  const plan = nearby.kind === "focus"
    ? nearby
    : planOpenDesk(await browser.tabs.query({}), path, deskOrigins, DEFAULT_DESK_ORIGIN);
  if (plan.kind === "create") {
    await browser.tabs.create({ url: plan.url });
    return;
  }
  await browser.tabs.update(plan.tabId, plan.url ? { url: plan.url, active: true } : { active: true });
  if (plan.windowId !== null) await browser.windows.update(plan.windowId, { focused: true });
}

export function openDeskPage(path: string): void {
  showDeskPage(path).catch(() => {
    browser.tabs.create({ url: `${DEFAULT_DESK_ORIGIN}${path}` }).catch(() => undefined);
  });
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

export function NextConfirm({
  subject,
  onSkip,
  onKeep,
}: {
  subject: NextConfirmSubject;
  onSkip: () => void;
  onKeep: () => void;
}) {
  const noteId = useId();
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onKeep();
  }

  return (
    <div className="next-confirm" role="group" aria-describedby={noteId} onKeyDown={onKeyDown}>
      <p id={noteId} className="next-confirm-note">{nextConfirmCopy(subject)}</p>
      <button type="button" className="primary" onClick={onSkip}>
        {NEXT_CONFIRM_SKIP_LABEL}
      </button>
      <button type="button" className="ghost" ref={keepRef} onClick={onKeep}>
        {NEXT_CONFIRM_KEEP_LABEL}
      </button>
    </div>
  );
}

export function DismissConfirm({
  copy,
  reason,
  busy,
  onReason,
  onConfirm,
  onCancel,
}: {
  copy: string;
  reason: string;
  busy: boolean;
  onReason: (reason: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const noteId = useId();
  const reasonId = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    reasonRef.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || busy) return;
    event.stopPropagation();
    onCancel();
  }

  return (
    <div className="dismiss-confirm" role="group" aria-label="Not interested" aria-describedby={noteId} onKeyDown={onKeyDown}>
      <p id={noteId} className="next-confirm-note">{copy}</p>
      <label className="dismiss-reason" htmlFor={reasonId}>Reason (optional)</label>
      <textarea
        id={reasonId}
        ref={reasonRef}
        className="dismiss-reason-text"
        value={reason}
        rows={3}
        placeholder="Why skip this lead…"
        disabled={busy}
        onChange={(event) => onReason(event.currentTarget.value)}
      />
      <button type="button" className="primary" disabled={busy} onClick={onConfirm}>
        Confirm
      </button>
      <button type="button" className="ghost" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
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

export function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </svg>
  );
}

export function DeskIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="7" y="3" width="10" height="7" rx="1" />
      <path d="M12 10v3" />
      <path d="M2 13h20" />
      <path d="M5 13v8" />
      <path d="M19 13v8" />
    </svg>
  );
}

export function DeskButton() {
  return (
    <button
      type="button"
      className="ghost icon-btn"
      aria-label="Open desk"
      title="Open desk"
      onClick={() => openDeskPage("/dashboard")}
    >
      <DeskIcon />
    </button>
  );
}

export type PanelLink = { label: string; path: string };

export const DESK_LINKS: readonly PanelLink[] = [
  { label: "Open desk", path: "/dashboard" },
  { label: "Learn", path: "/learn" },
];

export const ACCOUNT_PATH = "/account";

export const ACCOUNT_LINKS: readonly PanelLink[] = [
  { label: "Account", path: ACCOUNT_PATH },
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
      <p className="footnote">
        <a href={`${DEFAULT_DESK_ORIGIN}/privacy`} target="_blank" rel="noreferrer">Privacy Policy</a>
      </p>
    </main>
  );
}
