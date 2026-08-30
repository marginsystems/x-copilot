import { LegalLink } from "./Legal";
import { LearnChrome } from "./LearnChrome";
import { LearnCode } from "./LearnCode";
import { LearnTip } from "./LearnTip";
import {
  LEARN_APPLY_SNIPPET,
  LEARN_BDSM_AMPLIFIER_HEAD_HREF,
  LEARN_BDSM_AMPLIFIER_HEAD_SNIPPET,
  LEARN_BDSM_FOLLOW_HEAD_HREF,
  LEARN_BDSM_FOLLOW_HEAD_SNIPPET,
  LEARN_BDSM_LIKE_HEAD_HREF,
  LEARN_BDSM_LIKE_HEAD_SNIPPET,
  LEARN_BDSM_MULTI_HEAD_HREF,
  LEARN_BDSM_REDACT_HREF,
  LEARN_FOLLOW_AUTHOR_HREF,
  LEARN_FOLLOW_HEADING,
  LEARN_FOLLOW_PATH,
  LEARN_FORMULA,
  LEARN_GIVE_FIGURE_FOLLOW,
  LEARN_GIVE_FIGURE_LIKEBOT,
  LEARN_GIVE_HEADING,
  LEARN_GIVE_IMAGE,
  LEARN_GIVE_IMAGE_ALT,
  LEARN_GIVE_META,
  LEARN_HEADING,
  LEARN_MUTUAL_REPLY_HREF,
  LEARN_PHOENIX_FAV_HREF,
  LEARN_SCORER_HREF,
  LEARN_SOURCE_DATE,
  LEARN_SOURCE_REPO,
  LEARN_SOURCE_SHA,
  LEARN_THUNDER_CAP_HREF,
  LEARN_THUNDER_FOLLOW_TAKE_HREF,
  LEARN_THUNDER_FOLLOW_TAKE_SNIPPET,
  LEARN_VOLUME_HEADING,
  LEARN_VOLUME_PATH,
  LEARN_WEIGHTS_PATH,
  type LearnLessonView,
} from "./lib/learn";
import { PRODUCT_NAME } from "./lib/legal";
import type { AppView } from "./lib/appView";

export function LearnGivePage(props: {
  goToView: (view: AppView) => void;
}) {
  const onHome = () => props.goToView("home");
  const onCatalog = () => props.goToView("learn");
  const onOpenLesson = (view: LearnLessonView) => props.goToView(view);
  const onWeights = () => props.goToView("learnWeights");
  const onFollow = () => props.goToView("learnFollow");
  const onVolume = () => props.goToView("learnVolume");
  return (
    <LearnChrome
      heading={LEARN_GIVE_HEADING}
      meta={LEARN_GIVE_META}
      onHome={onHome}
      onCatalog={onCatalog}
      current="learnGive"
      onOpenLesson={onOpenLesson}
      rail={
        <>
          <p className="learn-rail-kicker">Like you give</p>
          <p className="learn-rail-weight">Not a debit</p>
          <p className="learn-rail-kicker">Follow author</p>
          <p className="learn-rail-weight">+4.0 × P</p>
          <p className="learn-rail-kicker">Thunder take</p>
          <p className="learn-rail-weight">10 000</p>
          <p className="learn-rail-formula">{LEARN_FORMULA}</p>
          <p>
            Favorite 0.5 and Follow author 4.0 multiply P(action) for this
            viewer of a candidate.{" "}
            <a href={LEARN_FOLLOW_AUTHOR_HREF} rel="noreferrer">
              FollowAuthorWeight
            </a>{" "}
            at <code>{LEARN_SOURCE_SHA}</code>.
          </p>
        </>
      }
    >
      <figure className="learn-figure">
        <img
          src={LEARN_GIVE_IMAGE}
          width={1200}
          height={630}
          alt={LEARN_GIVE_IMAGE_ALT}
        />
        <figcaption>
          The like mark enters their post. It does not enter your score tape.
        </figcaption>
      </figure>

      <h2>Two different likes</h2>
      <p>
        Lesson 01 is what a like is worth on a candidate this viewer is
        scoring — Favorite 0.5 multiplies{" "}
        <em>P(this viewer likes this post)</em>. This lesson is the like{" "}
        <em>you</em> tap. That tap is not a term on your next original.
      </p>
      <p>
        <a href={LEARN_SCORER_HREF} rel="noreferrer">
          apply
        </a>{" "}
        is <code>score.unwrap_or(0.0) * weight</code>. There is no ranking
        constant that says “author liked N posts today, subtract from their
        originals.” If a debit is not in the code, we do not say one.
      </p>
      <LearnCode
        file="home-mixer/scorers/ranking_scorer.rs"
        href={LEARN_SCORER_HREF}
      >
        {LEARN_APPLY_SNIPPET}
      </LearnCode>
      <LearnTip title="Liking them is not paying a tax">
        <p>
          Your like can still help <em>their</em> post — other viewers may
          then be predicted to favorite similar posts. See{" "}
          <LegalLink href={LEARN_WEIGHTS_PATH} onNavigate={onWeights}>
            {LEARN_HEADING}
          </LegalLink>
          . It is not subtracted from yours.
        </p>
      </LearnTip>

      <h2>Why not like every post you see</h2>
      <p>
        The cost is not a For You weight. It is a sequence detector.{" "}
        <a href={LEARN_BDSM_LIKE_HEAD_HREF} rel="noreferrer">
          LikeBot
        </a>{" "}
        is head 1. The flywheel labels are PURE_LIKE_API_BURST,
        LIKE_UNLIKE_CYCLE, STEADY_LIKE_DRIP, and LIKE_FARM_BOT. Those names
        are the training labels. They are not a published likes-per-day
        constant.
      </p>
      <LearnCode
        file="bdsm/runtime/heads.py"
        href={LEARN_BDSM_LIKE_HEAD_HREF}
      >
        {LEARN_BDSM_LIKE_HEAD_SNIPPET}
      </LearnCode>
      <figure className="learn-figure">
        <img
          src={LEARN_GIVE_FIGURE_LIKEBOT}
          width={1200}
          height={800}
          alt="Four LikeBot plates: burst, unlike cycle, steady drip, farm"
        />
        <figcaption>
          LikeBot labels from heads.py. Burst, unlike-cycle, steady drip,
          farm. Not a daily quota.
        </figcaption>
      </figure>
      <p>
        <a href={LEARN_BDSM_MULTI_HEAD_HREF} rel="noreferrer">
          MultiActionBot
        </a>{" "}
        also carries SCROLL_AND_LIKE.{" "}
        <a href={LEARN_PHOENIX_FAV_HREF} rel="noreferrer">
          Phoenix retrieval
        </a>{" "}
        trains the two towers with favorites as the positive signal. That is
        about what is retrieved <em>for you</em>. Liking everything makes
        favorite a noisy positive. It is still not a subtraction from your
        outgoing score.
      </p>
      <p>
        <a href={LEARN_BDSM_REDACT_HREF} rel="noreferrer">
          Operating points
        </a>{" "}
        ship as a 9.99 sentinel. We do not invent a fire threshold or a safe
        like count.
      </p>
      <LearnTip title="Should I like the post I reply to">
        <p>
          The snapshot does not say “like the parent when you reply” adds a
          For You term on your reply. A single sincere like is not
          STEADY_LIKE_DRIP by itself. Liking every parent as a habit is the
          drip the head is named for.
        </p>
      </LearnTip>

      <h2>Follow is not a free boost on your posts</h2>
      <p>
        Follow author +4.0 multiplies{" "}
        <em>P(this viewer follows this author)</em> when scoring a
        candidate. You following them is you as viewer. It does not add +4.0
        to your originals for other people.
      </p>
      <p>
        Mutual-follow +15.0 is{" "}
        <a href={LEARN_MUTUAL_REPLY_HREF} rel="noreferrer">
          BidirectionalFollowReplyWeightBoost
        </a>{" "}
        on <em>their</em> originals in <em>your</em> feed when you both
        follow. Following them does not mint that boost on your posts unless
        they follow you. In-network vs out-of-network is{" "}
        <LegalLink href={LEARN_FOLLOW_PATH} onNavigate={onFollow}>
          {LEARN_FOLLOW_HEADING}
        </LegalLink>
        .
      </p>
      <p>
        <a href={LEARN_BDSM_FOLLOW_HEAD_HREF} rel="noreferrer">
          FollowBot
        </a>{" "}
        is head 0. Labels: FOLLOW_UNFOLLOW_CYCLE, PURE_FOLLOW_API_BURST,
        API_ONLY_BOT, GROWTH_SERVICE_BOT, FOLLOW_FARM_BOT.
      </p>
      <LearnCode
        file="bdsm/runtime/heads.py"
        href={LEARN_BDSM_FOLLOW_HEAD_HREF}
      >
        {LEARN_BDSM_FOLLOW_HEAD_SNIPPET}
      </LearnCode>
      <p>
        <a href={LEARN_BDSM_AMPLIFIER_HEAD_HREF} rel="noreferrer">
          EngagementAmplifier
        </a>{" "}
        names the pipeline: FOLLOW_THEN_FAV, FOLLOW_THEN_REPLY,
        REPLY_THEN_FOLLOW, FOLLOW_LIKE_AMPLIFIER. Following everyone you
        reply to, then liking, is the pattern those labels describe. The
        snapshot does not say one follow-after-reply fires the head.
      </p>
      <LearnCode
        file="bdsm/runtime/heads.py"
        href={LEARN_BDSM_AMPLIFIER_HEAD_HREF}
      >
        {LEARN_BDSM_AMPLIFIER_HEAD_SNIPPET}
      </LearnCode>
      <LearnTip title="Should I follow people I reply to">
        <p>
          Follow them if you want their originals in your in-network pool.
          Do not follow them to buy +4.0 or +15.0 on your own posts. A
          mechanical reply-then-follow loop is what EngagementAmplifier is
          named for.
        </p>
      </LearnTip>

      <h2>A high following count is not a rank debit</h2>
      <p>
        This snapshot has no For You weight on how many accounts the{" "}
        <em>author</em> follows. Thunder, when it builds{" "}
        <em>your</em> in-network pool, takes at most{" "}
        <a href={LEARN_THUNDER_CAP_HREF} rel="noreferrer">
          10 000
        </a>{" "}
        followed ids.
      </p>
      <LearnCode
        file="thunder/thunder_service.rs"
        href={LEARN_THUNDER_FOLLOW_TAKE_HREF}
      >
        {LEARN_THUNDER_FOLLOW_TAKE_SNIPPET}
      </LearnCode>
      <figure className="learn-figure">
        <img
          src={LEARN_GIVE_FIGURE_FOLLOW}
          width={1200}
          height={800}
          alt="Thunder takes the first 10000 followed ids for your in-network fetch"
        />
        <figcaption>
          take(MAX_INPUT_LIST_SIZE) is 10 000 followed ids for your thunder
          fetch. It is not a deboost of your posts to other people.
        </figcaption>
      </figure>
      <p>
        If you follow more than 10 000, extras may not enter that fetch. That
        changes what you are shown. It does not say your originals rank
        worse. Volume caps on how many of <em>your</em> posts enter someone
        else's pool are{" "}
        <LegalLink href={LEARN_VOLUME_PATH} onNavigate={onVolume}>
          {LEARN_VOLUME_HEADING}
        </LegalLink>
        .
      </p>

      <h2>Source</h2>
      <p>
        Same snapshot as the other lessons:{" "}
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
        <LegalLink href={LEARN_WEIGHTS_PATH} onNavigate={onWeights}>
          {LEARN_HEADING}
        </LegalLink>
        .{" "}
        <LegalLink href={LEARN_FOLLOW_PATH} onNavigate={onFollow}>
          {LEARN_FOLLOW_HEADING}
        </LegalLink>
        .{" "}
        <LegalLink href={LEARN_VOLUME_PATH} onNavigate={onVolume}>
          {LEARN_VOLUME_HEADING}
        </LegalLink>
        .
      </p>
    </LearnChrome>
  );
}
