import { LegalLink } from "./Legal";
import { LearnChrome } from "./LearnChrome";
import { LearnCode } from "./LearnCode";
import { LearnTip } from "./LearnTip";
import {
  LEARN_APPLY_SNIPPET,
  LEARN_BDSM_ACTION_HREF,
  LEARN_BDSM_FEATURES_HREF,
  LEARN_BDSM_HEADS_HREF,
  LEARN_BDSM_REDACT_HREF,
  LEARN_BDSM_REPLY_HEAD_HREF,
  LEARN_BDSM_REPLY_HEAD_SNIPPET,
  LEARN_BDSM_ROPE_HREF,
  LEARN_BDSM_SEQ_HREF,
  LEARN_BDSM_TWEET_HEAD_HREF,
  LEARN_BDSM_TWEET_HEAD_SNIPPET,
  LEARN_DIVERSITY_APPLY_HREF,
  LEARN_DIVERSITY_DECAY,
  LEARN_DIVERSITY_ENABLE_HREF,
  LEARN_DIVERSITY_FLOOR,
  LEARN_DIVERSITY_FN_HREF,
  LEARN_DIVERSITY_HREF,
  LEARN_DIVERSITY_SNIPPET,
  LEARN_FORMULA,
  LEARN_HEADING,
  LEARN_OON_HREF,
  LEARN_README_ADJUST_HREF,
  LEARN_README_SCORE_HREF,
  LEARN_REPLY_HEADING,
  LEARN_REPLY_PATH,
  LEARN_SCORER_HREF,
  LEARN_SOURCE_DATE,
  LEARN_SOURCE_REPO,
  LEARN_SOURCE_SHA,
  LEARN_THUNDER_CAP_HREF,
  LEARN_THUNDER_CAP_SNIPPET,
  LEARN_THUNDER_FETCH_HREF,
  LEARN_VOLUME_HEADING,
  LEARN_VOLUME_META,
  LEARN_WEIGHTS_PATH,
  learnDiversityMultiplier,
  type LearnLessonView,
} from "./lib/learn";
import { PRODUCT_NAME } from "./lib/legal";

const SECOND_IN_SLATE = learnDiversityMultiplier(1);

export function LearnVolumePage(props: {
  onHome: () => void;
  onCatalog: () => void;
  onOpenLesson: (view: LearnLessonView) => void;
  onWeights: () => void;
  onReply: () => void;
}) {
  return (
    <LearnChrome
      heading={LEARN_VOLUME_HEADING}
      meta={LEARN_VOLUME_META}
      onHome={props.onHome}
      onCatalog={props.onCatalog}
      current="learnVolume"
      onOpenLesson={props.onOpenLesson}
      rail={
        <>
          <p className="learn-rail-kicker">Whose list</p>
          <p className="learn-rail-weight">This viewer</p>
          <p className="learn-rail-kicker">Decay</p>
          <p className="learn-rail-weight">{LEARN_DIVERSITY_DECAY}</p>
          <p className="learn-rail-kicker">Floor</p>
          <p className="learn-rail-weight">×{LEARN_DIVERSITY_FLOOR}</p>
          <p className="learn-rail-kicker">2nd in their slate</p>
          <p className="learn-rail-weight">×{SECOND_IN_SLATE}</p>
          <p className="learn-rail-formula">{LEARN_FORMULA}</p>
          <p>
            0.5 and 0.25 are not a rank. They multiply extras already in this
            viewer's For You list.{" "}
            <a href={LEARN_DIVERSITY_HREF} rel="noreferrer">
              AuthorDiversityDecay
            </a>{" "}
            at <code>{LEARN_SOURCE_SHA}</code>.
          </p>
        </>
      }
    >
      <h2>There is no replies-per-day number</h2>
      <p>
        This snapshot has no ranking constant for how many replies or originals
        you can post in a day. Scoring is per post, for this viewer.{" "}
        <a href={LEARN_README_SCORE_HREF} rel="noreferrer">
          {LEARN_FORMULA}
        </a>
        . If a daily quota is not in the code, we do not say one.
      </p>

      <h2>0.5 and 0.25 are this viewer's slate</h2>
      <p>
        After the weighted sum,{" "}
        <a href={LEARN_README_ADJUST_HREF} rel="noreferrer">
          author diversity
        </a>{" "}
        multiplies later posts from you that already sit in{" "}
        <em>this viewer's</em> For You list. It is not a rank of your account.
        {" "}
        <a href={LEARN_DIVERSITY_ENABLE_HREF} rel="noreferrer">
          EnableAuthorDiversity
        </a>{" "}
        is on.{" "}
        <a href={LEARN_DIVERSITY_HREF} rel="noreferrer">
          AuthorDiversityDecay
        </a>{" "}
        is {LEARN_DIVERSITY_DECAY} — the factor in the formula, not a score.{" "}
        <a href={LEARN_DIVERSITY_HREF} rel="noreferrer">
          AuthorDiversityFloor
        </a>{" "}
        is {LEARN_DIVERSITY_FLOOR} — later posts from you in that same list
        never go below ×{LEARN_DIVERSITY_FLOOR}.
      </p>
      <LearnCode
        file="home-mixer/scorers/ranking_scorer.rs"
        href={LEARN_DIVERSITY_FN_HREF}
      >
        {LEARN_DIVERSITY_SNIPPET}
      </LearnCode>
      <p>
        <code>k</code> is how many of this author's posts already sit higher in
        the same viewer's slate.{" "}
        <a href={LEARN_DIVERSITY_APPLY_HREF} rel="noreferrer">
          First of yours
        </a>{" "}
        (<code>k = 0</code>) is ×1.0. The second in their list is ×{SECOND_IN_SLATE}
        because (1 − {LEARN_DIVERSITY_FLOOR}) × {LEARN_DIVERSITY_DECAY} +{" "}
        {LEARN_DIVERSITY_FLOOR} = {SECOND_IN_SLATE}. Then 0.4375, 0.34375…
        never below ×{LEARN_DIVERSITY_FLOOR}.
      </p>
      <LearnTip title="This is not an account debit">
        <p>
          Diversity runs inside one viewer's ranked list. Posting fifty times
          today does not multiply your whole account by 0.25. It means a second
          post from you in that same For You slate is already discounted for
          that viewer, before the floor.
        </p>
      </LearnTip>

      <h2>Thunder 30 / 50 is a per-follower fetch cap</h2>
      <p>
        When thunder builds the in-network pool for this viewer, it walks each
        followed author's recent store newest-first, then takes at most{" "}
        <a href={LEARN_THUNDER_CAP_HREF} rel="noreferrer">
          30 replies and 50 originals
        </a>{" "}
        per author, and at most 1200 posts for the request.{" "}
        <a href={LEARN_THUNDER_FETCH_HREF} rel="noreferrer">
          get_all_posts_by_users
        </a>{" "}
        applies those limits to that viewer's fetch. That is how many of your
        recent posts can enter that follower's in-network candidates — not a
        daily posting quota, and not a penalty on your account.
      </p>
      <LearnCode file="thunder/config.rs" href={LEARN_THUNDER_CAP_HREF}>
        {LEARN_THUNDER_CAP_SNIPPET}
      </LearnCode>
      <p>
        If more than 30 of your replies sit in that recent store, extras may
        not enter this viewer's thunder fetch. Each follower builds their own
        pool. The code does not say those extras vanish for every follower, and
        it does not say "30 a day is safe."
      </p>
      <LearnTip title="Do not read 30 as a daily allowance">
        <p>
          The constant caps retrieval per author for one in-network request.
          It does not say post 30 replies a day, or that the first 30 skip
          every other limit. Diversity still multiplies extras already in that
          viewer's slate. ReplySpamBot and TweetSpamBot score the action
          sequence — a different stack.
        </p>
      </LearnTip>

      <h2>Zero engagement does not subtract</h2>
      <p>
        <a href={LEARN_SCORER_HREF} rel="noreferrer">
          apply
        </a>{" "}
        is <code>score.unwrap_or(0.0) * weight</code>. If the model predicts
        ~0 for like, reply, or follow, those terms add ~0. There is no
        "quiet post" ledger. You fail to earn predicted positives.
      </p>
      <LearnCode
        file="home-mixer/scorers/ranking_scorer.rs"
        href={LEARN_SCORER_HREF}
      >
        {LEARN_APPLY_SNIPPET}
      </LearnCode>
      <p>
        Negative defaults (not interested −43.2, mute −58.8, block −31.2,
        report −234.0) only move the score if the model predicts those actions
        for this viewer. An ignored reply is not a report.
      </p>
      <LearnTip title="Silence is not a debit">
        <p>
          A reply nobody is predicted to engage with does not "lose points."
          It also does not mint score. See{" "}
          <LegalLink href={LEARN_WEIGHTS_PATH} onNavigate={props.onWeights}>
            {LEARN_HEADING}
          </LegalLink>
          .
        </p>
      </LearnTip>

      <h2>ReplySpamBot and TweetSpamBot</h2>
      <p>
        <a href={LEARN_BDSM_HEADS_HREF} rel="noreferrer">
          BDSM
        </a>{" "}
        is a sequence-of-actions transformer that scores accounts from
        behavioral event streams. It is not a For You weight. The eight heads
        are FollowBot, LikeBot, EngagementAmplifier, ReplySpamBot, TweetSpamBot,
        RTBot, MultiActionBot, and LegitimateUser. Scoring is account-level,
        over a recent action sequence — not a daily reply quota, and not{" "}
        <code>weight × P(action)</code> for one post.
      </p>

      <h3>How the stack works</h3>
      <p>
        The backbone is a bidirectional transformer over recent actions.{" "}
        <a href={LEARN_BDSM_ROPE_HREF} rel="noreferrer">
          Time-aware RoPE
        </a>{" "}
        uses normalized action timestamps, not token index, so the model sees
        inter-action timing: burstiness, mechanical cadence.{" "}
        <a href={LEARN_BDSM_FEATURES_HREF} rel="noreferrer">
          Per-action features
        </a>{" "}
        include action type, product surface, dwell time, device/client, and
        engagement-target hashes.         The shipped config is{" "}
        <a href={LEARN_BDSM_SEQ_HREF} rel="noreferrer">
          256 action types, eight heads, sequence length 512, embedding width
          1024
        </a>
        . The runtime publishes an 8-wide score row, then{" "}
        <a href={LEARN_BDSM_ACTION_HREF} rel="noreferrer">
          graduated actioning
        </a>{" "}
        — challenge vs suspend.
      </p>

      <h3>ReplySpamBot</h3>
      <p>
        Head index 3. The flywheel labels in{" "}
        <a href={LEARN_BDSM_REPLY_HEAD_HREF} rel="noreferrer">
          heads.py
        </a>{" "}
        are REPLY_SPAM_NO_CONSUMPTION, REPLY_SPAM_BOT, and CONVERSATION_SPAMMER.
        Those names are the training labels for this head. They are not a
        published replies-per-day constant.
      </p>
      <LearnCode
        file="bdsm/runtime/heads.py"
        href={LEARN_BDSM_REPLY_HEAD_HREF}
      >
        {LEARN_BDSM_REPLY_HEAD_SNIPPET}
      </LearnCode>
      <p>
        The integer after the index is <code>selection_weight</code> in the
        training registry. This snapshot does not say it is a score on your
        account. REPLY_SPAM_NO_CONSUMPTION sits next to dwell time as a
        feature: the stack can see a reply stream that never consumes the
        parent. CONVERSATION_SPAMMER is the conversation-flood label. The
        snapshot does not define those labels further than their names.
      </p>

      <h3>TweetSpamBot</h3>
      <p>
        Head index 4. Flywheel labels: TWEET_CREATE_BURST, QUOTE_TWEET_SPAMMER,
        CONTENT_AMPLIFIER.
      </p>
      <LearnCode
        file="bdsm/runtime/heads.py"
        href={LEARN_BDSM_TWEET_HEAD_HREF}
      >
        {LEARN_BDSM_TWEET_HEAD_SNIPPET}
      </LearnCode>
      <p>
        TWEET_CREATE_BURST is a create-side burst, not Thunder's take(50)
        originals fetch. QUOTE_TWEET_SPAMMER is the quote-spam label. Same
        rule: we do not invent a count that stays under the head.
      </p>

      <h3>What this snapshot withholds</h3>
      <p>
        <a href={LEARN_BDSM_REDACT_HREF} rel="noreferrer">
          Operating points
        </a>{" "}
        ship as a 9.99 sentinel — out of range for a probability in [0, 1], so
        they never fire in this tree. The min-actions gate is 999999.
        Appeal-note templates are redacted. Publishing the real numbers would
        hand over the detector's evasion boundary. We do not invent a fire
        threshold or a safe daily count.
      </p>
      <LearnTip title="What the labels tell you to avoid">
        <p>
          Avoid replies with no consumption — no dwell on the parent. Avoid
          conversation spam. Avoid tweet-create bursts and quote-tweet spam.
          Time-aware RoPE is built to see mechanical cadence. This is not
          diversity 0.5 / 0.25, and it is not Thunder's 30. Those multiply or
          cap this viewer's For You slate. These heads score the account's
          action sequence.
        </p>
      </LearnTip>

      <h2>Do not start at 50 because a thread said so</h2>
      <p>
        The code does not say start at five and scale to fifty. P(action) is
        viewer-specific. Diversity decays extras in one slate. Followed replies
        still take{" "}
        <a href={LEARN_OON_HREF} rel="noreferrer">
          ×0.75
        </a>{" "}
        when that switch is on. A mechanical reply flood is what ReplySpamBot
        is for. A create burst is what TweetSpamBot is for.
      </p>
      <p>
        Craft still matters —{" "}
        <LegalLink href={LEARN_REPLY_PATH} onNavigate={props.onReply}>
          {LEARN_REPLY_HEADING}
        </LegalLink>
        . Volume without predicted reply or like does not mint score.
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
        <LegalLink href={LEARN_WEIGHTS_PATH} onNavigate={props.onWeights}>
          {LEARN_HEADING}
        </LegalLink>
        .{" "}
        <LegalLink href={LEARN_REPLY_PATH} onNavigate={props.onReply}>
          {LEARN_REPLY_HEADING}
        </LegalLink>
        .
      </p>
    </LearnChrome>
  );
}
