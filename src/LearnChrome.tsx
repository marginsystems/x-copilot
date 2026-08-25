import type { ReactNode } from "react";
import { LegalLink, LegalLinks } from "./Legal";
import { LEARN_NOTES } from "./lib/learn";
import { PRODUCT_NAME } from "./lib/legal";

type LearnNote = (typeof LEARN_NOTES)[number]["view"];

export function LearnChrome(props: {
  heading: string;
  meta: string;
  note: LearnNote;
  onHome: () => void;
  onLearn: () => void;
  onFollow: () => void;
  rail?: ReactNode;
  children: ReactNode;
}) {
  function go(view: LearnNote) {
    if (view === "learn") props.onLearn();
    else props.onFollow();
  }

  return (
    <article className="legal-page learn-page">
      <p className="legal-kicker">
        <LegalLink href="/" onNavigate={props.onHome}>
          {PRODUCT_NAME}
        </LegalLink>
        {" / "}
        Learn
      </p>
      <h1>{props.heading}</h1>
      <p className="legal-meta">{props.meta}</p>
      <nav className="learn-notes" aria-label="Learn notes">
        {LEARN_NOTES.map((note) => (
          <LegalLink
            key={note.view}
            href={note.href}
            className={props.note === note.view ? "is-current" : undefined}
            onNavigate={() => go(note.view)}
          >
            {note.label}
          </LegalLink>
        ))}
      </nav>
      <div className="learn-layout">
        <div className="learn-main">{props.children}</div>
        {props.rail ? <aside className="learn-rail">{props.rail}</aside> : null}
      </div>
      <nav className="legal-foot" aria-label="Learn footer">
        <LegalLinks />
        <LegalLink href="/" onNavigate={props.onHome}>
          Back to {PRODUCT_NAME}
        </LegalLink>
      </nav>
    </article>
  );
}
