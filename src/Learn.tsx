import { LegalLink, LegalLinks } from "./Legal";
import {
  LEARN_DIVERSITY_HREF,
  LEARN_FORMULA,
  LEARN_HEADING,
  LEARN_META,
  LEARN_OON_HREF,
  LEARN_PARAM_COMMENT_HREF,
  LEARN_PARAM_FILE_HREF,
  LEARN_README_SCORE_HREF,
  LEARN_SCORER_HREF,
  LEARN_SOURCE_DATE,
  LEARN_SOURCE_REPO,
  LEARN_SOURCE_SHA,
  LEARN_WEIGHTS,
  formatLearnWeight,
  weightPermalink,
} from "./lib/learn";
import { PRODUCT_NAME } from "./lib/legal";

export function LearnPage(props: { onHome: () => void; onFollow: () => void }) {
  return (
    <article className="legal-page learn-page">
      <p className="legal-kicker">
        <LegalLink href="/" onNavigate={props.onHome}>
          {PRODUCT_NAME}
        </LegalLink>
        {" / "}
        Learn
      </p>
      <h1>{LEARN_HEADING}</h1>
      <p className="legal-meta">{LEARN_META}</p>

      <h2>Weights multiply P(action)</h2>
      <p>
        X ranks each post by how likely you are to take each action, then
        multiplies those probabilities by weights in the code. The weights do
        not multiply raw likes, replies, or reports. That comment is in{" "}
        <a href={LEARN_PARAM_COMMENT_HREF} rel="noreferrer">
          param.rs
        </a>{" "}
        as of 24 August 2026.
      </p>
      <p>
        One common misread is “1 report = 468 likes.” That is wrong. Report is
        rare, so it is weighted hard so the prediction can move the score at
        all. Mass report or block campaigns mostly move ranking for people
        similar to the reporters, and only for posts served on Home — not a
        coordinated visit.
      </p>

      <h2>The score</h2>
      <p>
        <a href={LEARN_README_SCORE_HREF} rel="noreferrer">
          X writes the formula
        </a>{" "}
        as:
      </p>
      <pre className="learn-formula">
        <code>{LEARN_FORMULA}</code>
      </pre>
      <p>
        The arithmetic is{" "}
        <code>score.unwrap_or(0.0) * weight</code> in{" "}
        <a href={LEARN_SCORER_HREF} rel="noreferrer">
          ranking_scorer.rs
        </a>
        . Then{" "}
        <a href={LEARN_DIVERSITY_HREF} rel="noreferrer">
          author-diversity decay
        </a>{" "}
        (0.5, floor 0.25),{" "}
        <a href={LEARN_OON_HREF} rel="noreferrer">
          out-of-network × 0.75
        </a>
        , and a new-author boost.
      </p>

      <h2>Default weights</h2>
      <p>
        Defaults in{" "}
        <a href={LEARN_PARAM_FILE_HREF} rel="noreferrer">
          param.rs
        </a>{" "}
        at <code>{LEARN_SOURCE_SHA}</code>. Positive lifts the post if the model
        thinks you will do it. Negative penalizes if it thinks you will hide,
        mute, block, or report. Feature switches still exist — cite defaults in
        this snapshot, not every For You feed.
      </p>
      <div className="learn-table-wrap">
        <table>
          <caption>Default For You action weights at {LEARN_SOURCE_SHA}</caption>
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">Default</th>
              <th scope="col">Param</th>
            </tr>
          </thead>
          <tbody>
            {LEARN_WEIGHTS.map((row) => (
              <tr key={row.param}>
                <td>{row.action}</td>
                <td>{formatLearnWeight(row.weight)}</td>
                <td>
                  <a href={weightPermalink(row)} rel="noreferrer">
                    {row.param}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Like 0.5, retweet 1.0, reply 5.0, quote 5.0 is the relative value of
        those predicted actions — not “a reply is worth 10 likes on the post.”
        Copy-link share is the largest positive default (+20.0). Dwell weight
        is 0.0; continuous dwell time is +0.004.
      </p>

      <h2>Follow and out-of-network</h2>
      <p>
        Posts from accounts you follow come from <code>thunder/</code>.
        Out-of-network posts are multiplied by 0.75. Predicting that you will
        follow the author is +4.0.{" "}
        <LegalLink href="/learn/follow" onNavigate={props.onFollow}>
          Follow and out-of-network
        </LegalLink>{" "}
        has the in-network reply and repost discount.
      </p>

      <h2>Source</h2>
      <p>
        We read the official open-source repo,{" "}
        <a href={`${LEARN_SOURCE_REPO}/tree/${LEARN_SOURCE_SHA}`} rel="noreferrer">
          xai-org/x-algorithm
        </a>{" "}
        at <code>{LEARN_SOURCE_SHA}</code> ({LEARN_SOURCE_DATE}). That is the
        current For You code. <code>twitter/the-algorithm</code> is the 2023
        dump — useful history, the wrong source for today. Production defaults
        are mirrored into <code>param.rs</code>. If a number is not in this
        snapshot, we do not say it.
      </p>
      <p>
        {PRODUCT_NAME} is not affiliated with X Corp.
      </p>

      <nav className="legal-foot" aria-label="Learn footer">
        <LegalLinks />
        <LegalLink href="/" onNavigate={props.onHome}>
          Back to {PRODUCT_NAME}
        </LegalLink>
      </nav>
    </article>
  );
}
