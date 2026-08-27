import { LearnChrome } from "./LearnChrome";
import { LearnCode } from "./LearnCode";
import { LearnTip } from "./LearnTip";
import {
  LEARN_FOLLOW_AUTHOR_HREF,
  LEARN_FOLLOW_HEADING,
  LEARN_FOLLOW_META,
  LEARN_FORMULA,
  LEARN_MUTUAL_REPLY_APPLY_HREF,
  LEARN_MUTUAL_REPLY_HREF,
  LEARN_OON_APPLY_HREF,
  LEARN_OON_HREF,
  LEARN_OON_SNIPPET,
  LEARN_OON_SWITCH_HREF,
  LEARN_SOURCE_DATE,
  LEARN_SOURCE_REPO,
  LEARN_SOURCE_SHA,
  LEARN_THUNDER_HREF,
  type LearnLessonView,
} from "./lib/learn";
import { PRODUCT_NAME } from "./lib/legal";

export function LearnFollowPage(props: {
  onHome: () => void;
  onCatalog: () => void;
  onOpenLesson: (view: LearnLessonView) => void;
}) {
  return (
    <LearnChrome
      heading={LEARN_FOLLOW_HEADING}
      meta={LEARN_FOLLOW_META}
      onHome={props.onHome}
      onCatalog={props.onCatalog}
      current="learnFollow"
      onOpenLesson={props.onOpenLesson}
      rail={
        <>
          <p className="learn-rail-kicker">Score</p>
          <p className="learn-rail-formula">{LEARN_FORMULA}</p>
          <p className="learn-rail-kicker">Then</p>
          <p className="learn-rail-weight">× 0.75</p>
          <p>
            Out-of-network posts, and followed replies or reposts when the
            switch is on.{" "}
            <a href={LEARN_OON_HREF} rel="noreferrer">
              OonWeightFactor
            </a>{" "}
            at <code>{LEARN_SOURCE_SHA}</code>.
          </p>
        </>
      }
    >
      <h2>In-network vs out-of-network</h2>
      <p>
        For You is assembled from two retrievals.{" "}
        <a href={LEARN_THUNDER_HREF} rel="noreferrer">
          In-network posts
        </a>{" "}
        come from <code>thunder/</code> — recent posts from accounts you
        follow, held in memory. Out-of-network posts come from Phoenix
        retrieval and SimClusters. Both are ranked by the same model.
      </p>
      <p>
        After the weighted score, out-of-network posts are multiplied by{" "}
        <a href={LEARN_OON_HREF} rel="noreferrer">
          0.75
        </a>
        . That is a discount on the score, not a count of followers.
      </p>

      <h2>Followed replies and reposts</h2>
      <p>
        The same 0.75 factor also applies to replies and reposts from
        accounts you follow when{" "}
        <a href={LEARN_OON_SWITCH_HREF} rel="noreferrer">
          EnableOonRescoreForInNetworkRepliesRetweets
        </a>{" "}
        is on. The default in this snapshot is true.
      </p>
      <LearnCode
        file="home-mixer/scorers/ranking_scorer.rs"
        href={LEARN_OON_APPLY_HREF}
      >
        {LEARN_OON_SNIPPET}
      </LearnCode>
      <LearnTip title="Followed is not always in-network">
        <p>
          A reply or repost from someone you follow can still take the
          out-of-network discount. The check is{" "}
          <a href={LEARN_OON_APPLY_HREF} rel="noreferrer">
            oon_applies
          </a>
          .
        </p>
      </LearnTip>

      <h2>Follow-author and mutual-follow reply</h2>
      <p>
        Predicting that you will follow the author is{" "}
        <a href={LEARN_FOLLOW_AUTHOR_HREF} rel="noreferrer">
          +4.0
        </a>
        . That multiplies P(follow author), not a raw follow.
      </p>
      <p>
        The reply-action weight becomes 5.0 +{" "}
        <a href={LEARN_MUTUAL_REPLY_HREF} rel="noreferrer">
          15.0
        </a>{" "}
        for posts from a mutual-follow author that are not themselves replies
        or reposts. That is{" "}
        <a href={LEARN_MUTUAL_REPLY_APPLY_HREF} rel="noreferrer">
          reply_weight_for
        </a>
        — still P(reply) times a weight, not “a reply is worth 20 likes.”
      </p>

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
    </LearnChrome>
  );
}
