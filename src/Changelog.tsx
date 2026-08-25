import { LegalLink, LegalLinks } from "./Legal";
import {
  CHANGELOG,
  changelogByDate,
  formatChangelogDate,
} from "./lib/changelog";
import { PRODUCT_NAME } from "./lib/legal";

export function ChangelogPage(props: { onHome: () => void }) {
  return (
    <article className="legal-page changelog-page">
      <p className="legal-kicker">
        <LegalLink href="/" onNavigate={props.onHome}>
          {PRODUCT_NAME}
        </LegalLink>
      </p>
      <h1>Changelog</h1>
      <p className="legal-meta">
        What shipped. Newest first. Each row is a launch note — not a blog.
      </p>
      {changelogByDate(CHANGELOG).map((day) => (
        <section key={day.date} aria-labelledby={`ship-${day.date}`}>
          <h2 id={`ship-${day.date}`}>{formatChangelogDate(day.date)}</h2>
          <ul>
            {day.items.map((item) => (
              <li key={`${day.date}-${item.title}`}>
                <strong>{item.title}.</strong> {item.body}
                {item.href ? (
                  <>
                    {" "}
                    <a href={item.href} rel="noreferrer">
                      PR
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <nav className="legal-foot" aria-label="Changelog footer">
        <LegalLinks />
        <LegalLink href="/" onNavigate={props.onHome}>
          Back to {PRODUCT_NAME}
        </LegalLink>
      </nav>
    </article>
  );
}
