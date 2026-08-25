import { LegalLink } from "./Legal";
import { LearnChrome } from "./LearnChrome";
import {
  LEARN_HUB_HEADING,
  LEARN_HUB_META,
  LEARN_LESSONS,
} from "./lib/learn";

export function LearnHubPage(props: {
  onHome: () => void;
  onOpenLesson: () => void;
}) {
  return (
    <LearnChrome
      heading={LEARN_HUB_HEADING}
      meta={LEARN_HUB_META}
      onHome={props.onHome}
    >
      <ol className="learn-catalog">
        {LEARN_LESSONS.map((lesson) => (
          <li key={lesson.href}>
            <LegalLink
              href={lesson.href}
              className="learn-card"
              onNavigate={props.onOpenLesson}
            >
              <span className="learn-card-num">{lesson.number}</span>
              <span className="learn-card-body">
                <strong>{lesson.heading}</strong>
                <span>{lesson.lede}</span>
              </span>
              <span className="learn-card-open">Open</span>
            </LegalLink>
          </li>
        ))}
      </ol>
    </LearnChrome>
  );
}
