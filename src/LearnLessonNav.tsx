import { LegalLink } from "./Legal";
import {
  LEARN_HUB_HEADING,
  LEARN_LESSONS,
  learnAdjacentLessons,
  type LearnLesson,
  type LearnLessonView,
  type LearnNavView,
} from "./lib/learn";

export function LearnToc(props: {
  current: LearnNavView;
  onCatalog: () => void;
  onOpenLesson: (view: LearnLessonView) => void;
}) {
  return (
    <nav className="learn-toc" aria-label="Lessons">
      <LegalLink
        href="/learn"
        className="learn-toc-back"
        onNavigate={props.onCatalog}
      >
        Back to {LEARN_HUB_HEADING}
      </LegalLink>
      <p className="learn-toc-kicker">Lessons</p>
      <ol className="learn-toc-list">
        {LEARN_LESSONS.map((lesson) => {
          const current = lesson.view === props.current;
          return (
            <li key={lesson.href}>
              {current ? (
                <span className="learn-toc-item is-current" aria-current="page">
                  <span className="learn-toc-num">{lesson.number}</span>
                  <span>{lesson.heading}</span>
                </span>
              ) : (
                <LegalLink
                  href={lesson.href}
                  className="learn-toc-item"
                  onNavigate={() => props.onOpenLesson(lesson.view)}
                >
                  <span className="learn-toc-num">{lesson.number}</span>
                  <span>{lesson.heading}</span>
                </LegalLink>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function LearnMobileBar(props: { onCatalog: () => void }) {
  return (
    <div className="learn-mobile-bar">
      <LegalLink
        href="/learn"
        className="ghost learn-back"
        onNavigate={props.onCatalog}
      >
        Back to {LEARN_HUB_HEADING}
      </LegalLink>
    </div>
  );
}

function PagerLink(props: {
  lesson: LearnLesson;
  kind: "prev" | "next";
  onOpen: (view: LearnLessonView) => void;
}) {
  const label = props.kind === "prev" ? "Previous" : "Next";
  return (
    <LegalLink
      href={props.lesson.href}
      className={`learn-pager-link is-${props.kind}`}
      onNavigate={() => props.onOpen(props.lesson.view)}
    >
      <span className="learn-pager-kind">{label}</span>
      <span>
        {props.lesson.number} {props.lesson.heading}
      </span>
    </LegalLink>
  );
}

export function LearnPager(props: {
  current: LearnNavView;
  onOpenLesson: (view: LearnLessonView) => void;
}) {
  const { prev, next } = learnAdjacentLessons(props.current);
  if (!prev && !next) return null;
  return (
    <nav className="learn-pager" aria-label="Lesson">
      {prev ? (
        <PagerLink lesson={prev} kind="prev" onOpen={props.onOpenLesson} />
      ) : (
        <span />
      )}
      {next ? (
        <PagerLink lesson={next} kind="next" onOpen={props.onOpenLesson} />
      ) : (
        <span />
      )}
    </nav>
  );
}
