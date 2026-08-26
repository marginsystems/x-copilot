import type { ReactNode } from "react";
import { LegalLink, LegalLinks } from "./Legal";
import { LEARN_HUB_HEADING } from "./lib/learn";
import { PRODUCT_NAME } from "./lib/legal";

export function LearnChrome(props: {
  heading: string;
  meta: string;
  onHome: () => void;
  onCatalog?: () => void;
  rail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="legal-page learn-page">
      <p className="legal-kicker">
        <LegalLink href="/" onNavigate={props.onHome}>
          {PRODUCT_NAME}
        </LegalLink>
        {" / "}
        {props.onCatalog ? (
          <LegalLink href="/learn" onNavigate={props.onCatalog}>
            {LEARN_HUB_HEADING}
          </LegalLink>
        ) : (
          LEARN_HUB_HEADING
        )}
      </p>
      <h1>{props.heading}</h1>
      <p className="legal-meta">{props.meta}</p>
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
