import { LegalLink } from "./Legal";
import { LearnChrome } from "./LearnChrome";
import { LearnCode } from "./LearnCode";
import { LearnTip } from "./LearnTip";
import {
  LEARN_APPLY_SNIPPET,
  LEARN_BDSM_ACTION_HREF,
  LEARN_BDSM_HEADS_HREF,
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
} from "./lib/learn";
import { PRODUCT_NAME } from "./lib/legal";

const SECOND_IN_SLATE = learnDiversityMultiplier(1);

export function LearnVolumePage(props: {
  onHome: () => void;
  onCatalog: () => void;
  onWeights: () => void;
  onReply: () => void;
}) {
  return (
    <LearnChrome
      heading={LEARN_VOLUME_HEADING}
      meta={LEARN_VOLUME_META}
      onHome={props.onHome}
      onCatalog={props.onCatalog}
      rail={
        <>
          <p className="learn-rail-kicker">Daily quota</p>
          <p className="learn-rail-weight">None</p>
          <p className="learn-rail-kicker">2nd in one slate</p>
          <p className="learn-rail-weight">×{SECOND_IN_SLATE}</p>
          <p className="learn-rail-kicker">Floor</p>
          <p className="learn-rail-weight">×{LEARN_DIVERSITY_FLOOR}</p>
          <p className="learn-rail-formula">{LEARN_FORMULA}</p>
          <p>
            No replies-per-day constant. Diversity is one viewer's slate.{" "}
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

      <h2>Extra posts in one slate decay</h2>
      <p>
        After the weighted sum,{" "}
        <a href={LEARN_README_ADJUST_HREF} rel="noreferrer">
          author diversity
        </a>{" "}
        multiplies each later post from         the same author in{" "}
        <em>this viewer's</em> For You slate.{" "}
        <a href={LEARN_DIVERSITY_ENABLE_HREF} rel="noreferrer">
          EnableAuthorDiversity
        </a>{" "}
        is on.{" "}
        <a href={LEARN_DIVERSITY_HREF} rel="noreferrer">
          Decay {LEARN_DIVERSITY_DECAY}
        </a>
        , floor {LEARN_DIVERSITY_FLOOR}.
      </p>
      <LearnCode
        file="home-mixer/scorers/ranking_scorer.rs"
        href={LEARN_DIVERSITY_FN_HREF}
      >
        {LEARN_DIVERSITY_SNIPPET}
      </LearnCode>
      <p>
        <code>k</code> is how many of this author's posts already sit higher in
        the same slate.{" "}
        <a href={LEARN_DIVERSITY_APPLY_HREF} rel="noreferrer">
          First post
        </a>{" "}
        (<code>k = 0</code>) is ×1.0. Second is ×{SECOND_IN_SLATE}. Then 0.4375,
        0.34375… never below {LEARN_DIVERSITY_FLOOR}.
      </p>
      <LearnTip title="This is not an account debit">
        <p>
          Diversity runs inside one viewer's ranked list. Posting fifty times
          today does not multiply your whole account by 0.25. It means a second
          post from you in the same For You slate is already discounted before
          the floor.
        </p>
      </LearnTip>

      <h2>Thunder 30 / 50 is a fetch cap</h2>
      <p>
        When thunder builds the in-network pool, it returns at most{" "}
        <a href={LEARN_THUNDER_CAP_HREF} rel="noreferrer">
          30 replies and 50 originals
        </a>{" "}
        per followed author, and at most 1200 posts for the request.{" "}
        <a href={LEARN_THUNDER_FETCH_HREF} rel="noreferrer">
          get_all_posts_by_users
        </a>{" "}
        takes those limits from the recent store. That is how many of your
        recent posts can enter that viewer's in-network candidates — not a
        daily posting quota, and not a For You penalty.
      </p>
      <LearnCode file="thunder/config.rs" href={LEARN_THUNDER_CAP_HREF}>
        {LEARN_THUNDER_CAP_SNIPPET}
      </LearnCode>
      <LearnTip title="Do not read 30/50 as how many you may post">
        <p>
          Those constants cap retrieval per author for one in-network fetch.
          They do not say "post 30 replies a day" or "stop at 50 originals."
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

      <h2>Burstiness is a different stack</h2>
      <p>
        <a href={LEARN_BDSM_HEADS_HREF} rel="noreferrer">
          BDSM
        </a>{" "}
        has ReplySpamBot and TweetSpamBot heads. It reads action sequences and
        timing — burstiness, mechanical cadence.{" "}
        <a href={LEARN_BDSM_ACTION_HREF} rel="noreferrer">
          Graduated actioning
        </a>{" "}
        is challenge vs suspend. That is not a published "50 a day" For You
        weight. This snapshot does not give a safe daily count.
      </p>

      <h2>Do not start at 50 because a thread said so</h2>
      <p>
        The code does not say start at five and scale to fifty. P(action) is
        viewer-specific. Diversity decays extras in one slate. Followed replies
        still take{" "}
        <a href={LEARN_OON_HREF} rel="noreferrer">
          ×0.75
        </a>{" "}
        when that switch is on. A mechanical flood is what ReplySpamBot is for.
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
