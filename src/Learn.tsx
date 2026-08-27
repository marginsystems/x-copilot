import { useState } from "react";
import { LegalLink } from "./Legal";
import { LearnChrome } from "./LearnChrome";
import { LearnCode } from "./LearnCode";
import { LearnTip } from "./LearnTip";
import { LearnWeights } from "./LearnWeights";
import {
  LEARN_APPLY_SNIPPET,
  LEARN_DIVERSITY_HREF,
  LEARN_FORMULA,
  LEARN_HEADING,
  LEARN_META,
  LEARN_FOLLOW_HEADING,
  LEARN_FOLLOW_PATH,
  LEARN_REPLY_HEADING,
  LEARN_REPLY_PATH,
  LEARN_VOLUME_HEADING,
  LEARN_VOLUME_PATH,
  LEARN_OON_HREF,
  LEARN_PARAM_COMMENT_HREF,
  LEARN_PARAM_COMMENT_SNIPPET,
  LEARN_PARAM_FILE_HREF,
  LEARN_README_SCORE_HREF,
  LEARN_SCORER_HREF,
  LEARN_SOURCE_DATE,
  LEARN_SOURCE_DATE_LABEL,
  LEARN_SOURCE_REPO,
  LEARN_SOURCE_SHA,
  LEARN_WEIGHTS,
  formatLearnWeight,
  weightPermalink,
  type LearnLessonView,
} from "./lib/learn";
import { PRODUCT_NAME } from "./lib/legal";

export function LearnPage(props: {
  onHome: () => void;
  onCatalog: () => void;
  onOpenLesson: (view: LearnLessonView) => void;
  onFollow: () => void;
  onReply: () => void;
  onVolume: () => void;
}) {
  const [selected, setSelected] = useState(LEARN_WEIGHTS[0]!);

  return (
    <LearnChrome
      heading={LEARN_HEADING}
      meta={LEARN_META}
      onHome={props.onHome}
      onCatalog={props.onCatalog}
      current="learnWeights"
      onOpenLesson={props.onOpenLesson}
      rail={
        <>
          <p className="learn-rail-kicker">Score</p>
          <p className="learn-rail-formula">{LEARN_FORMULA}</p>
          <p className="learn-rail-kicker">Selected default</p>
          <p className="learn-rail-weight">{formatLearnWeight(selected.weight)}</p>
          <p>
            {selected.action}. Multiplies P(action), not a raw count.{" "}
            <a href={weightPermalink(selected)} rel="noreferrer">
              {selected.param}
            </a>{" "}
            at <code>{LEARN_SOURCE_SHA}</code>.
          </p>
        </>
      }
    >
      <h2>Weights multiply P(action)</h2>
      <p>
        X ranks each post by how likely you are to take each action, then
        multiplies those probabilities by weights in the code. The weights do
        not multiply raw likes, replies, or reports. That comment is in{" "}
        <a href={LEARN_PARAM_COMMENT_HREF} rel="noreferrer">
          param.rs
        </a>{" "}
        as of {LEARN_SOURCE_DATE_LABEL}.
      </p>
      <LearnCode file="home-mixer/params/param.rs" href={LEARN_PARAM_COMMENT_HREF}>
        {LEARN_PARAM_COMMENT_SNIPPET}
      </LearnCode>
      <LearnTip title="Do not read 1 report = 468 likes" defaultOpen>
        <p>
          Report is rare, so it is weighted hard so the prediction can move
          the score at all. Mass report or block campaigns mostly move ranking
          for people similar to the reporters, and only for posts served on
          Home — not a coordinated visit.
        </p>
      </LearnTip>

      <h2>The score</h2>
      <p>
        <a href={LEARN_README_SCORE_HREF} rel="noreferrer">
          X writes the formula
        </a>{" "}
        as <code>{LEARN_FORMULA}</code>. The arithmetic is:
      </p>
      <LearnCode
        file="home-mixer/scorers/ranking_scorer.rs"
        href={LEARN_SCORER_HREF}
      >
        {LEARN_APPLY_SNIPPET}
      </LearnCode>
      <p>
        Then{" "}
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
      <LearnWeights selected={selected} onSelect={setSelected} />
      <p>
        Like 0.5, retweet 1.0, reply 5.0, quote 5.0 is the relative value of
        those predicted actions — not “a reply is worth 10 likes on the post.”
        Copy-link share is the largest positive default (+20.0). Dwell weight
        is 0.0; continuous dwell time is +0.004.
      </p>

      <h2>Source</h2>
      <p>
        We read the official open-source repo,{" "}
        <a href={`${LEARN_SOURCE_REPO}/tree/${LEARN_SOURCE_SHA}`} rel="noreferrer">
          xai-org/x-algorithm
        </a>{" "}
        at <code>{LEARN_SOURCE_SHA}</code> ({LEARN_SOURCE_DATE}). That is the
        current For You code. <code>twitter/the-algorithm</code> is the 2023
        dump — useful history, the wrong source for today. If a number is not
        in this snapshot, we do not say it.
      </p>
      <p>
        {PRODUCT_NAME} is not affiliated with X Corp.
      </p>
      <p>
        Related:{" "}
        <LegalLink href={LEARN_REPLY_PATH} onNavigate={props.onReply}>
          {LEARN_REPLY_HEADING}
        </LegalLink>
        .{" "}
        <LegalLink href={LEARN_VOLUME_PATH} onNavigate={props.onVolume}>
          {LEARN_VOLUME_HEADING}
        </LegalLink>
        .{" "}
        <LegalLink href={LEARN_FOLLOW_PATH} onNavigate={props.onFollow}>
          {LEARN_FOLLOW_HEADING}
        </LegalLink>
        .
      </p>
    </LearnChrome>
  );
}
