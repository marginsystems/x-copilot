import { LegalLink, LegalLinks } from "./Legal";
import {
  LEARN_FOLLOW_AUTHOR_HREF,
  LEARN_FOLLOW_HEADING,
  LEARN_FOLLOW_META,
  LEARN_MUTUAL_REPLY_APPLY_HREF,
  LEARN_MUTUAL_REPLY_HREF,
  LEARN_OON_APPLY_HREF,
  LEARN_OON_HREF,
  LEARN_OON_SWITCH_HREF,
  LEARN_SOURCE_DATE,
  LEARN_SOURCE_REPO,
  LEARN_SOURCE_SHA,
  LEARN_THUNDER_HREF,
} from "./lib/learn";
import { PRODUCT_NAME } from "./lib/legal";

export function LearnFollowPage(props: {
  onHome: () => void;
  onLearn: () => void;
}) {
  return (
    <article className="legal-page learn-page">
      <p className="legal-kicker">
        <LegalLink href="/" onNavigate={props.onHome}>
          {PRODUCT_NAME}
        </LegalLink>
        {" / "}
        <LegalLink href="/learn" onNavigate={props.onLearn}>
          Learn
        </LegalLink>
      </p>
      <h1>{LEARN_FOLLOW_HEADING}</h1>
      <p className="legal-meta">{LEARN_FOLLOW_META}</p>

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
        is on. The default in this snapshot is true. The check is{" "}
        <a href={LEARN_OON_APPLY_HREF} rel="noreferrer">
          oon_applies
        </a>{" "}
        in <code>ranking_scorer.rs</code>.
      </p>

      <h2>Follow-author and mutual-follow reply</h2>
      <p>
        Predicting that you will follow the author is{" "}
        <a href={LEARN_FOLLOW_AUTHOR_HREF} rel="noreferrer">
          +4.0
        </a>
        . That multiplies P(follow author), not a raw follow.
      </p>
      <p>
        If the author is a mutual follow and the post is not itself a reply
        or repost, the reply weight becomes 5.0 +{" "}
        <a href={LEARN_MUTUAL_REPLY_HREF} rel="noreferrer">
          15.0
        </a>
        . That is{" "}
        <a href={LEARN_MUTUAL_REPLY_APPLY_HREF} rel="noreferrer">
          reply_weight_for
        </a>
        — still P(reply) times a weight, not “a reply is worth 20 likes.”
      </p>

      <h2>Source</h2>
      <p>
        Same snapshot as{" "}
        <LegalLink href="/learn" onNavigate={props.onLearn}>
          What a like is worth
        </LegalLink>
        :{" "}
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

      <nav className="legal-foot" aria-label="Learn footer">
        <LegalLinks />
        <LegalLink href="/learn" onNavigate={props.onLearn}>
          What a like is worth
        </LegalLink>
        <LegalLink href="/" onNavigate={props.onHome}>
          Back to {PRODUCT_NAME}
        </LegalLink>
      </nav>
    </article>
  );
}
