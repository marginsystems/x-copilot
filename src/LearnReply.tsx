import { LegalLink } from "./Legal";
import { LearnChrome } from "./LearnChrome";
import { LearnCode } from "./LearnCode";
import { LearnTip } from "./LearnTip";
import {
  LEARN_FORMULA,
  LEARN_HEADING,
  LEARN_MUTUAL_REPLY_APPLY_HREF,
  LEARN_MUTUAL_REPLY_HREF,
  LEARN_REPLY_HEADING,
  LEARN_REPLY_META,
  LEARN_REPLY_WEIGHT_HREF,
  LEARN_REPLY_WEIGHT_SNIPPET,
  LEARN_SOURCE_DATE,
  LEARN_VOLUME_HEADING,
  LEARN_VOLUME_PATH,
  LEARN_SOURCE_REPO,
  LEARN_SOURCE_SHA,
  LEARN_WEIGHTS_PATH,
  type LearnLessonView,
} from "./lib/learn";
import { PRODUCT_NAME } from "./lib/legal";

export function LearnReplyPage(props: {
  onHome: () => void;
  onCatalog: () => void;
  onOpenLesson: (view: LearnLessonView) => void;
  onWeights: () => void;
  onVolume: () => void;
}) {
  return (
    <LearnChrome
      heading={LEARN_REPLY_HEADING}
      meta={LEARN_REPLY_META}
      onHome={props.onHome}
      onCatalog={props.onCatalog}
      current="learnReply"
      onOpenLesson={props.onOpenLesson}
      rail={
        <>
          <p className="learn-rail-kicker">Reply</p>
          <p className="learn-rail-weight">+5.0</p>
          <p className="learn-rail-kicker">Mutual original</p>
          <p className="learn-rail-weight">+15.0</p>
          <p className="learn-rail-formula">{LEARN_FORMULA}</p>
          <p>
            Both multiply P(reply) for this viewer.{" "}
            <a href={LEARN_REPLY_WEIGHT_HREF} rel="noreferrer">
              ReplyWeight
            </a>{" "}
            and{" "}
            <a href={LEARN_MUTUAL_REPLY_HREF} rel="noreferrer">
              BidirectionalFollowReplyWeightBoost
            </a>{" "}
            at <code>{LEARN_SOURCE_SHA}</code>.
          </p>
        </>
      }
    >
      <h2>Reply is +5.0</h2>
      <p>
        The default reply weight is{" "}
        <a href={LEARN_REPLY_WEIGHT_HREF} rel="noreferrer">
          5.0
        </a>
        . Like is 0.5. Those numbers multiply P(action) for this viewer — not
        raw replies, and not “a reply is worth 10 likes.”
      </p>
      <LearnTip title="Do not read a reply = 10 likes">
        <p>
          Same rule as{" "}
          <LegalLink href={LEARN_WEIGHTS_PATH} onNavigate={props.onWeights}>
            {LEARN_HEADING}
          </LegalLink>
          . The weights apply to predicted probabilities. A pile of empty
          replies does not cancel or mint likes in the score.
        </p>
      </LearnTip>

      <h2>Mutual-follow originals add +15.0</h2>
      <p>
        If this viewer mutually follows the author, and the post is not itself
        a reply or a repost,{" "}
        <a href={LEARN_MUTUAL_REPLY_APPLY_HREF} rel="noreferrer">
          reply_weight_for
        </a>{" "}
        adds{" "}
        <a href={LEARN_MUTUAL_REPLY_HREF} rel="noreferrer">
          15.0
        </a>
        . That is 5.0 + 15.0 on P(reply) — still not a raw count.
      </p>
      <LearnCode
        file="home-mixer/scorers/ranking_scorer.rs"
        href={LEARN_MUTUAL_REPLY_APPLY_HREF}
      >
        {LEARN_REPLY_WEIGHT_SNIPPET}
      </LearnCode>
      <LearnTip title="The boost is on their original">
        <p>
          The +15.0 is for originals from a mutual-follow author. It does not
          apply to replies or reposts, including yours under their thread.
        </p>
      </LearnTip>

      <h2>Craft, not a switch</h2>
      <p>
        The street name is reply farming. This snapshot has no farm flag. The
        model predicts whether this viewer will reply, then multiplies that
        probability by the weights above.
      </p>
      <p>
        Writing that invites a reply is craft. It does not change the weights.
        It is a bet that P(reply) goes up for the people you want in the room.
      </p>
      <ul>
        <li>
          Ask a real question someone here can answer — not “thoughts?”
        </li>
        <li>Leave a stake: a take they can agree with or cut.</li>
        <li>Name the other side so a reply has somewhere to land.</li>
        <li>End on a specific fork, not a slogan.</li>
      </ul>

      <h2>Source</h2>
      <p>
        Same snapshot as What a like is worth:{" "}
        <a href={`${LEARN_SOURCE_REPO}/tree/${LEARN_SOURCE_SHA}`} rel="noreferrer">
          xai-org/x-algorithm
        </a>{" "}
        at <code>{LEARN_SOURCE_SHA}</code> ({LEARN_SOURCE_DATE}). Feature
        switches still exist. If a number is not in this snapshot, we do not
        say it.
      </p>
      <p>
        {PRODUCT_NAME} is not affiliated with X Corp.
      </p>
      <p>
        Related:{" "}
        <LegalLink href={LEARN_WEIGHTS_PATH} onNavigate={props.onWeights}>
          {LEARN_HEADING}
        </LegalLink>
        .{" "}
        <LegalLink href={LEARN_VOLUME_PATH} onNavigate={props.onVolume}>
          {LEARN_VOLUME_HEADING}
        </LegalLink>
        .
      </p>
    </LearnChrome>
  );
}
