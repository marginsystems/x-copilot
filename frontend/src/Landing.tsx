import { DeskRow } from "./desk/DeskRow";
import { LegalLinks } from "./routing/LegalLinks";
import { Onboarding } from "./Onboarding";
import { writeOnboardingAgenda } from "./lib/onboarding";

export function BootScreen() {
  return (
    <div className="gate" role="status" aria-live="polite">
      <div className="gate-card">
        <img className="gate-mark is-busy" src="/favicon.svg" width={48} height={48} alt="" />
        <p className="gate-kicker">x-copilot</p>
        <p className="gate-status">Checking your session…</p>
      </div>
    </div>
  );
}

type MockCard = {
  id: string;
  bait: number;
  baitClass: "low" | "mid";
  summary: string;
  author: string;
  ago: string;
  engage?: "priority";
};

/** Static demo cards — believable desk output, never fetched. */
const MOCK_CARDS: MockCard[] = [
  {
    id: "m1",
    bait: 20,
    baitClass: "low",
    summary:
      "Question to engineers about what their job becomes when AI writes and reviews most of the code.",
    author: "@buildsinpublic",
    ago: "38m",
    engage: "priority",
  },
  {
    id: "m2",
    bait: 25,
    baitClass: "low",
    summary:
      "Founder asks whether daily posting is actually worth it while running a startup.",
    author: "@solo_founder_km",
    ago: "1h",
  },
  {
    id: "m3",
    bait: 40,
    baitClass: "mid",
    summary:
      "Take that bare-bones MVPs no longer work now that building with AI is fast.",
    author: "@shipthings",
    ago: "2h",
  },
  {
    id: "m4",
    bait: 30,
    baitClass: "low",
    summary:
      "Thread on pricing models for a developer-tools startup — pay-per-use vs subscriptions.",
    author: "@devtools_meg",
    ago: "3h",
  },
];

function MockThreadRow({
  card,
  onCta,
}: {
  card: MockCard;
  onCta: () => void;
}) {
  return (
    <DeskRow
      lead={card.bait}
      leadTitle="Engagement-bait risk — higher is worse"
      leadClassName={`bait ${card.baitClass}`}
      summary={card.summary}
      meta={
        <>
          <span>{card.author}</span>
          <span>{card.ago}</span>
          {card.engage ? (
            <span className={`chip chip-${card.engage}`}>{card.engage}</span>
          ) : null}
        </>
      }
      onPrimary={onCta}
      primaryLabel="Mark interacted"
      onSkip={onCta}
      onDismiss={onCta}
    />
  );
}

export function Landing(props: {
  notice?: string;
  signedIn?: boolean;
  onSignIn: () => void;
  onOpenDesk: () => void;
}) {
  return (
    <div className="landing">
      <div className="landing-inner">
        <section className="landing-hero">
          <p className="gate-kicker">x-copilot — your X copilot</p>
          <h1 className="landing-title">
            The For You feed grows X.
            <br />
            This desk grows <em>you</em>.
          </h1>
          <p className="landing-lede">
            For You is built to keep you scrolling — it optimizes for your
            attention, not your account. x-copilot is a curation desk: it
            searches public X for the threads worth <strong>your</strong> reply,
            scored against your agenda, and picks your next move. It never
            writes a word for you. You open X. You write. You post. Always as
            yourself.
          </p>
          <div className="landing-cta">
            {props.signedIn ? (
              <button
                type="button"
                className="primary landing-signin"
                onClick={props.onOpenDesk}
              >
                Open the desk
              </button>
            ) : (
              <button
                type="button"
                className="primary landing-signin"
                onClick={props.onSignIn}
              >
                Sign in
              </button>
            )}
            <p className="gate-free">
              Free plan — 1,500 credits every month. No credit card.{" "}
              <a href="/pricing">See plans</a>
            </p>
            {props.notice ? (
              <p className="status auth-notice" role="status">
                {props.notice}
              </p>
            ) : null}
          </div>
        </section>

        {!props.signedIn ? (
          <section
            className="landing-section landing-agenda-builder"
            aria-labelledby="landing-agenda-builder-title"
          >
            <div className="landing-agenda-builder-head">
              <h2 id="landing-agenda-builder-title">
                Write your first Scout agenda
              </h2>
              <p>
                Try the real setup before creating an account. Pick what you
                care about, generate a few agendas, then sign in only when one
                is worth running.
              </p>
            </div>
            <Onboarding
              mode="preview"
              embedded
              kicker="Try the agenda desk"
              completeLabel="Sign in to run this agenda"
              onComplete={(agenda) => {
                writeOnboardingAgenda(agenda);
                props.onSignIn();
              }}
            />
          </section>
        ) : null}

        <section className="landing-section" aria-labelledby="landing-problem">
          <h2 id="landing-problem">The feed is not on your side</h2>
          <p>
            X's recommendation engine answers one question: what will keep this
            person on the app? That is a great way to be entertained and a slow
            way to grow. The posts you <em>should</em> reply to — open questions
            in your niche, threads where your experience actually lands, people
            worth knowing — rarely surface at the moment a reply would matter.
          </p>
          <p>
            x-copilot flips the question: given <strong>your</strong> agenda —
            grow an audience, promote what you're building, go deeper in a niche
            — which conversations happening right now deserve your reply? Scout
            searches public X, filters the bait, and scores what's left.
          </p>
        </section>

        <section className="landing-section" aria-labelledby="landing-desk">
          <h2 id="landing-desk">This is the desk</h2>
          <p className="landing-section-sub">
            Live demo with sample data. Every card shows an engagement-bait
            score and what the thread is about. The reply is yours to write on
            X.
          </p>
          <div className="landing-mock" aria-label="Example curated threads">
            {MOCK_CARDS.map((card) => (
              <MockThreadRow
                key={card.id}
                card={card}
                onCta={props.signedIn ? props.onOpenDesk : props.onSignIn}
              />
            ))}
          </div>
        </section>

        <section className="landing-section" aria-labelledby="landing-human">
          <h2 id="landing-human">Human in the loop, by design</h2>
          <ul className="landing-list">
            <li>
              <strong>Nothing is ever auto-sent.</strong> No auto-replies, no
              auto-likes, no scheduled blasts. You post on X yourself — nothing
              fires without you.
            </li>
            <li>
              <strong>Every word is yours.</strong> x-copilot uses AI to find
              threads worth your time and to pick your next move. It never
              writes your replies or posts — you open X and write them
              yourself.
            </li>
            <li>
              <strong>You stay inside normal X use.</strong> Follow the desk —
              pick a thread, open X, write as yourself — and you're simply a
              person replying to public posts. That's the whole point.
            </li>
          </ul>
          <p className="landing-fine">
            x-copilot reads public posts through the official X API. Built by
            Mergestorm, Inc. Not affiliated with X Corp.
          </p>
        </section>

        <section className="landing-section" aria-labelledby="landing-agenda">
          <h2 id="landing-agenda">One agenda at a time</h2>
          <p>
            Tell Scout what this season is about: <em>find founders and
            engineers talking about AI tooling</em>, or <em>surface threads
            where my product genuinely answers the question</em>. Scout hunts
            for that, and the desk picks your next move. What you say stays
            yours.
          </p>
        </section>

        <section
          className="landing-section landing-free"
          aria-labelledby="landing-free-title"
        >
          <h2 id="landing-free-title">Start free, feel the desk</h2>
          <p className="landing-section-sub">
            The Free plan is rate-limited on purpose — enough to experience the
            product every day, forever.
          </p>
          <ul className="landing-plan">
            <li>
              <strong>1,500</strong> credits / month
            </li>
            <li>
              <strong>1</strong> Scout takeoff / day
            </li>
            <li>
              <strong>15</strong> watch posts / day
            </li>
          </ul>
          <p className="gate-free">
            No credit card. Upgrade only if the desk earns it.
          </p>
        </section>

        <footer className="landing-footer">
          <p className="brand-legal">
            Built by Mergestorm, Inc. Not affiliated with X Corp. By signing in
            you agree to the Terms and acknowledge the Privacy Policy.
          </p>
          <LegalLinks />
        </footer>
      </div>
    </div>
  );
}
