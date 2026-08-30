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
  LEARN_BDSM_REPLY_HEAD_HREF,
  LEARN_BDSM_SINK_ENFORCE_HREF,
  LEARN_BDSM_SINK_LIVENESS_HREF,
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
          <p className="learn-rail-kicker">On a reply</p>
          <p className="learn-rail-weight">No like</p>
          <p className="learn-rail-kicker">On a reply</p>
          <p className="learn-rail-weight">No follow</p>
          <p className="learn-rail-kicker">Fire line</p>
          <p className="learn-rail-weight">Redacted</p>
          <p className="learn-rail-formula">{LEARN_FORMULA}</p>
          <p>
            Favorite 0.5 and Follow author 4.0 still multiply P(action) for
            this viewer of a candidate.{" "}
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

      <h2>The rule</h2>
      <p>
        When you reply, do not like the parent. Do not auto-follow them.
        That is the operator habit. It is not a published likes-per-day or
        follows-per-day number.
      </p>
      <p>
        <a href={LEARN_BDSM_REDACT_HREF} rel="noreferrer">
          Operating points
        </a>{" "}
        ship as a 9.99 sentinel. We do not know 10 a day from 10 a minute.
        An unknown line is not permission to like or follow every account
        you reply to.
      </p>
      <LearnTip title="Does that cut your For You score">
        <p>
          No. A like or follow you give is not subtracted from your next
          original.{" "}
          <a href={LEARN_SCORER_HREF} rel="noreferrer">
            apply
          </a>{" "}
          is still <code>score.unwrap_or(0.0) * weight</code>. There is no
          ranking constant for “author liked the parent.” STEADY_LIKE_DRIP
          is not a For You debit. It is also not a free pass. It is a
          sequence label on a different stack, with a withheld fire line.
        </p>
      </LearnTip>

      <h2>Two different likes</h2>
      <p>
        Lesson 01 is what a like is worth on a candidate this viewer is
        scoring — Favorite 0.5 multiplies{" "}
        <em>P(this viewer likes this post)</em>. This lesson is the like{" "}
        <em>you</em> tap. That tap is not a term on your next original.
      </p>
      <LearnCode
        file="home-mixer/scorers/ranking_scorer.rs"
        href={LEARN_SCORER_HREF}
      >
        {LEARN_APPLY_SNIPPET}
      </LearnCode>
      <p>
        Your like can still help <em>their</em> post. See{" "}
        <LegalLink href={LEARN_WEIGHTS_PATH} onNavigate={onWeights}>
          {LEARN_HEADING}
        </LegalLink>
        . Growth here is your account, not theirs. We do not like the
        parent to be polite.
      </p>

      <h2>LikeBot is not a daily quota</h2>
      <p>
        <a href={LEARN_BDSM_LIKE_HEAD_HREF} rel="noreferrer">
          LikeBot
        </a>{" "}
        is head 1. Training labels: PURE_LIKE_API_BURST, LIKE_UNLIKE_CYCLE,
        STEADY_LIKE_DRIP, LIKE_FARM_BOT. The model scores P(LikeBot) over
        the last 512 actions. It does not print STEADY_LIKE_DRIP at serve
        time.
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
          farm. Not a daily quota. Not a For You weight.
        </figcaption>
      </figure>
      <p>
        Liking every parent as you reply is the drip that label is named
        for. We do not know the tau. So we do not do the drip.{" "}
        <a href={LEARN_BDSM_MULTI_HEAD_HREF} rel="noreferrer">
          MultiActionBot
        </a>{" "}
        also carries SCROLL_AND_LIKE.
      </p>
      <p>
        In the public sink table, LikeBot and MultiActionBot sit on{" "}
        <a href={LEARN_BDSM_SINK_LIVENESS_HREF} rel="noreferrer">
          paused_liveness_thresholds
        </a>
        — a challenge lane, not the main enforcement table. Those taus are
        also 9.99. We do not say a drip “does nothing.” We do not say it
        subtracts from your originals. We say: unknown line, do not build
        the habit.
      </p>

      <h2>Do not follow who you reply to</h2>
      <p>
        Follow author +4.0 multiplies{" "}
        <em>P(this viewer follows this author)</em> on a candidate. You
        following them does not add +4.0 to your originals. Mutual-follow
        +15.0 is{" "}
        <a href={LEARN_MUTUAL_REPLY_HREF} rel="noreferrer">
          BidirectionalFollowReplyWeightBoost
        </a>{" "}
        on <em>their</em> originals in <em>your</em> feed, and only if they
        follow you. In-network vs out-of-network is{" "}
        <LegalLink href={LEARN_FOLLOW_PATH} onNavigate={onFollow}>
          {LEARN_FOLLOW_HEADING}
        </LegalLink>
        .
      </p>
      <p>
        <a href={LEARN_BDSM_FOLLOW_HEAD_HREF} rel="noreferrer">
          FollowBot
        </a>{" "}
        labels: FOLLOW_UNFOLLOW_CYCLE, PURE_FOLLOW_API_BURST, API_ONLY_BOT,
        GROWTH_SERVICE_BOT, FOLLOW_FARM_BOT. Same withheld line. Do not
        follow every reply to “be safe later.”
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
        REPLY_THEN_FOLLOW, FOLLOW_LIKE_AMPLIFIER. Reply then like then
        follow is that pattern. FollowBot and Amplifier sit on the{" "}
        <a href={LEARN_BDSM_SINK_ENFORCE_HREF} rel="noreferrer">
          main enforcement table
        </a>
        . Taus are 9.99. We do not invent a fire. We do not run the
        pipeline.
      </p>
      <LearnCode
        file="bdsm/runtime/heads.py"
        href={LEARN_BDSM_AMPLIFIER_HEAD_HREF}
      >
        {LEARN_BDSM_AMPLIFIER_HEAD_SNIPPET}
      </LearnCode>
      <LearnTip title="Follow them later, on purpose">
        <p>
          Follow an account because you want their originals in your
          in-network pool. Not as a step after the reply. Not to buy +4.0
          or +15.0 on your posts.
        </p>
      </LearnTip>

      <h2>Replies are a different head</h2>
      <p>
        Reply volume is not this lesson.{" "}
        <a href={LEARN_BDSM_REPLY_HEAD_HREF} rel="noreferrer">
          ReplySpamBot
        </a>{" "}
        is head 3. Its fire line is also redacted. There is no daily reply
        quota in For You. Fetch caps and slate decay are{" "}
        <LegalLink href={LEARN_VOLUME_PATH} onNavigate={onVolume}>
          {LEARN_VOLUME_HEADING}
        </LegalLink>
        . Do not read “do not like the parent” as “replies are free.”
      </p>

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
        If you follow more than 10 000, extras may not enter that fetch.
        That changes what you are shown. It does not say your originals
        rank worse.
      </p>

      <h2>Source</h2>
      <p>
        Same snapshot as the other lessons:{" "}
        <a href={`${LEARN_SOURCE_REPO}/tree/${LEARN_SOURCE_SHA}`} rel="noreferrer">
          xai-org/x-algorithm
        </a>{" "}
        at <code>{LEARN_SOURCE_SHA}</code> ({LEARN_SOURCE_DATE}). Feature
        switches still exist. If a number is not in this snapshot, we do
        not say it.
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
