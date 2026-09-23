import type { ReactNode } from "react";

export function LegalLink(props: {
  href: string;
  children: ReactNode;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <a
      href={props.href}
      className={props.className}
      onClick={(e) => {
        if (!props.onNavigate) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
          return;
        }
        e.preventDefault();
        props.onNavigate();
      }}
    >
      {props.children}
    </a>
  );
}

export function LegalLinks(props: { className?: string }) {
  return (
    <nav className={props.className ?? "legal-links"} aria-label="Legal">
      <a href="/pricing">Pricing</a>
      <a href="/changelog">Changelog</a>
      <a href="/learn">Learn</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </nav>
  );
}
