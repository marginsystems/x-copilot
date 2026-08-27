import type { ReactNode } from "react";
import { LegalLink, LegalLinks } from "./Legal";
import { LearnMobileBar, LearnPager, LearnToc } from "./LearnLessonNav";
import {
  LEARN_HUB_HEADING,
  type LearnLessonView,
  type LearnNavView,
} from "./lib/learn";
import { PRODUCT_NAME } from "./lib/legal";

export function LearnChrome(props: {
  heading: string;
  meta: string;
  onHome: () => void;
  onCatalog?: () => void;
  current?: LearnNavView;
  onOpenLesson?: (view: LearnLessonView) => void;
  rail?: ReactNode;
  children: ReactNode;
}) {
  const nav =
    props.onCatalog && props.current && props.onOpenLesson
      ? {
          current: props.current,
          onCatalog: props.onCatalog,
          onOpenLesson: props.onOpenLesson,
        }
      : null;

  return (
    <article
      className={
        nav ? "legal-page learn-page has-nav" : "legal-page learn-page"
      }
    >
      {nav ? (
        <LearnToc
          current={nav.current}
          onCatalog={nav.onCatalog}
          onOpenLesson={nav.onOpenLesson}
        />
      ) : null}
      <div className="learn-page-col">
        {nav ? <LearnMobileBar onCatalog={nav.onCatalog} /> : null}
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
        {nav ? (
          <LearnPager
            current={nav.current}
            onOpenLesson={nav.onOpenLesson}
          />
        ) : null}
        <nav className="legal-foot" aria-label="Learn footer">
          <LegalLinks />
          <LegalLink href="/" onNavigate={props.onHome}>
            Back to {PRODUCT_NAME}
          </LegalLink>
        </nav>
      </div>
    </article>
  );
}
