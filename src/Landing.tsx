import { useState } from "react";
import { LegalLinks } from "./Legal";

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
  text: string;
  reason: string;
  tags: string[];
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
    text: "Serious question for engineers: if AI writes the code and reviews the code, what exactly is the job in two years? Not doom-posting, genuinely asking what you're doubling down on.",
    reason:
      "Open question in your niche, low bait, no reply from a big account yet — a grounded answer can anchor the thread.",
    tags: ["question", "ai-engineering"],
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
    text: "Everyone says post every day. I'm running a company. Is organic X actually the best channel for a technical product or are we all just cosplaying marketing?",
    reason:
      "Fits a promote-your-product agenda: you can answer from experience without pitching in the first line.",
    tags: ["distribution", "founder"],
  },
  {
    id: "m3",
    bait: 40,
    baitClass: "mid",
    summary:
      "Take that bare-bones MVPs no longer work now that building with AI is fast.",
    author: "@shipthings",
    ago: "2h",
    text: "Building with AI means doing more, not just faster. A bare-bones MVP isn't impressive anymore — the bar moved. Half-finished ideas used to be acceptable. Now they read as low effort.",
    reason:
      "Opinion post with real discussion under it. Pick a side before drafting — agree with a sharper example, or push back with a counter-case.",
    tags: ["opinion", "mvp"],
  },
  {
    id: "m4",
    bait: 30,
    baitClass: "low",
    summary:
      "Thread on pricing models for a developer-tools startup — pay-per-use vs subscriptions.",
    author: "@devtools_meg",
    ago: "3h",
    text: "Talked to 30 devtools founders about pricing. Pay-per-use feels fair but subscriptions fund the roadmap. Where this landed surprised me — usage caps with a flat floor won almost every time.",
    reason:
      "Data-backed thread in-niche; a reply adding your own pricing experience earns follows from the right audience.",
    tags: ["pricing", "devtools"],
  },
];

function MockThreadRow({
  card,
  open,
  signedIn,
  onToggle,
  onCta,
}: {
  card: MockCard;
  open: boolean;
  signedIn: boolean;
  onToggle: () => void;
  onCta: () => void;
}) {
  return (
    <article className={open ? "thread-row open" : "thread-row"}>
      <button
        type="button"
        className="row-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span
          className={`bait ${card.baitClass}`}
          title="Engagement-bait risk — higher is worse"
        >
          {card.bait}
        </span>
        <span className="row-main">
          <span className="row-summary">{card.summary}</span>
          <span className="row-meta">
            <span>{card.author}</span>
            <span>{card.ago}</span>
            {card.engage ? (
              <span className={`chip chip-${card.engage}`}>{card.engage}</span>
            ) : null}
          </span>
        </span>
        <span className="caret" aria-hidden="true">
          {open ? "–" : "+"}
        </span>
      </button>

      {open ? (
        <div className="row-detail">
          <p className="original">{card.text}</p>
          <p className="reason">{card.reason}</p>
          <div className="tags">
            {card.tags.map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <div className="row">
            <button className="primary" type="button" onClick={onCta}>
              Mark interacted
            </button>
            <button className="ghost" type="button" onClick={onCta}>
              Skip
            </button>
            <button className="ghost" type="button" onClick={onCta}>
              Not interested
            </button>
            <span className="landing-demo-hint">
              {signedIn
                ? "demo — open the desk to use this"
                : "demo — sign in to use the desk"}
            </span>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function Landing(props: {
  notice?: string;
  signedIn?: boolean;
  onSignIn: () => void;
  onOpenDesk: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(MOCK_CARDS[0]!.id);

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
            scored against your agenda and your style. You review. You post.
            Always as yourself.
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
              Free plan — 1,500 credits every month. No credit card.
            </p>
            {props.notice ? (
              <p className="status auth-notice" role="status">
                {props.notice}
              </p>
            ) : null}
          </div>
        </section>

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
            Live demo with sample data — tap a card. Every card shows an
            engagement-bait score, why it was picked, and what Scout thinks the
            move is.
          </p>
          <div className="landing-mock" aria-label="Example curated threads">
            {MOCK_CARDS.map((card) => (
              <MockThreadRow
                key={card.id}
                card={card}
                open={openId === card.id}
                signedIn={Boolean(props.signedIn)}
                onToggle={() =>
                  setOpenId((id) => (id === card.id ? null : card.id))
                }
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
              auto-likes, no scheduled blasts. You post from the desk or on X
              — nothing fires without you.
            </li>
            <li>
              <strong>Suggested drafts require your edit.</strong> Voice
              suggestions are drafted from your own past posts — and you must
              rework a draft before the desk treats it as ready. Then you post
              it on X yourself.
            </li>
            <li>
              <strong>You stay inside normal X use.</strong> Follow the desk —
              review, edit, post as yourself — and you're simply a person
              replying to public posts. That's the whole point.
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
            for that — and Voice keeps any suggested draft sounding like you,
            because it learns only from your own public posts.
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
            <li>
              <strong>10</strong> voice suggests / day
            </li>
          </ul>
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
              No credit card. Upgrade only if the desk earns it.
            </p>
          </div>
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
