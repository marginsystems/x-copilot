import { LegalLink } from "./routing/LegalLinks";
import { LearnChrome } from "./LearnChrome";
import { LearnCode } from "./LearnCode";
import { LearnTip } from "./LearnTip";
import {
  LEARN_BDSM_REPLY_HEAD_HREF,
  LEARN_FORMULA,
  LEARN_GIVE_HEADING,
  LEARN_GIVE_PATH,
  LEARN_HEADING,
  LEARN_READ_APPLY_HREF,
  LEARN_READ_APPLY_SNIPPET,
  LEARN_READ_BDSM_DWELL_HREF,
  LEARN_READ_CHANGE_DATE_LABEL,
  LEARN_READ_CHANGE_HREF,
  LEARN_READ_CHANGE_SHA,
  LEARN_READ_CHANGE_SNIPPET,
  LEARN_READ_CHANGES,
  LEARN_READ_CLICK_DWELL_HREF,
  LEARN_READ_CLICK_HREF,
  LEARN_READ_COLD_POOL_HREF,
  LEARN_READ_COLD_START_CAP_HREF,
  LEARN_READ_COLD_START_CHANGE_HREF,
  LEARN_READ_COLD_START_ELIGIBLE_HREF,
  LEARN_READ_COLD_START_SLOT_HREF,
  LEARN_READ_INSULT_CORPUS_HREF,
  LEARN_READ_INSULT_LEVEL_HREF,
  LEARN_READ_INSULT_RULE_HREF,
  LEARN_READ_MOE_SWITCH_HREF,
  LEARN_READ_DATE,
  LEARN_READ_HEADING,
  LEARN_READ_LABEL_HREF,
  LEARN_READ_LABEL_ON_HREF,
  LEARN_READ_LABEL_SNIPPET,
  LEARN_READ_LOSS_HREF,
  LEARN_READ_LOSS_SNIPPET,
  LEARN_READ_META,
  LEARN_READ_NOT_INTERESTED_HREF,
  LEARN_READ_SECONDS_HREF,
  LEARN_READ_SHA,
  LEARN_SOURCE_REPO,
  LEARN_SOURCE_SHA,
  LEARN_WEIGHTS_PATH,
  formatLearnChange,
  type LearnLessonView,
} from "./lib/learn";
import { PRODUCT_NAME } from "./lib/legal";
import type { AppView } from "./lib/appView";

export function LearnReadPage(props: { goToView: (view: AppView) => void }) {
  const onHome = () => props.goToView("home");
  const onCatalog = () => props.goToView("learn");
  const onOpenLesson = (view: LearnLessonView) => props.goToView(view);
  const onWeights = () => props.goToView("learnWeights");
  const onGive = () => props.goToView("learnGive");
  return (
    <LearnChrome
      heading={LEARN_READ_HEADING}
      meta={LEARN_READ_META}
      onHome={onHome}
      onCatalog={onCatalog}
      current="learnRead"
      onOpenLesson={onOpenLesson}
      rail={
        <>
          <p className="learn-rail-kicker">Tap</p>
          <p className="learn-rail-weight">0.4 → 0.3</p>
          <p className="learn-rail-kicker">Stays past 10 s</p>
          <p className="learn-rail-weight">0 → +0.4</p>
          <p className="learn-rail-kicker">Not interested</p>
          <p className="learn-rail-weight">−47.52</p>
          <p className="learn-rail-formula">{LEARN_FORMULA}</p>
          <p>
            All three multiply P(action) for this viewer. Changed in{" "}
            <a href={LEARN_READ_CHANGE_HREF} rel="noreferrer">
              <code>{LEARN_READ_CHANGE_SHA}</code>
            </a>{" "}
            ({LEARN_READ_CHANGE_DATE_LABEL}).
          </p>
        </>
      }
    >
      <p>
        On {LEARN_READ_CHANGE_DATE_LABEL} X changed three For You weights in
        one release. It was the first change to the action weights since 25
        August, 24 releases earlier. The tap lost a quarter of its weight. A brand-new weight pays
        for the read that follows it. And “not interested” got 10% heavier.
      </p>
      <LearnCode
        file="home-mixer/params/param.rs"
        href={LEARN_READ_CHANGE_HREF}
      >
        {LEARN_READ_CHANGE_SNIPPET}
      </LearnCode>

      <h2>What moved since lessons 1–4</h2>
      <p>
        Lessons 1–4 cite <code>{LEARN_SOURCE_SHA}</code>. This lesson cites{" "}
        <code>{LEARN_READ_SHA}</code>. Where a number below differs from an
        older lesson, this table is the newer default.
      </p>
      <div className="learn-table-wrap">
        <table>
          <caption>
            Action weights that changed between <code>{LEARN_SOURCE_SHA}</code>{" "}
            and <code>{LEARN_READ_SHA}</code>. Each number links to its line.
          </caption>
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">Was</th>
              <th scope="col">Now</th>
              <th scope="col">Changed</th>
            </tr>
          </thead>
          <tbody>
            {LEARN_READ_CHANGES.map((row) => (
              <tr key={row.param}>
                <td>
                  {row.action}
                  <br />
                  <code>{row.param}</code>
                </td>
                <td>
                  <a href={row.beforeHref} rel="noreferrer">
                    {formatLearnChange(row.before)}
                  </a>
                </td>
                <td>
                  <a href={row.afterHref} rel="noreferrer">
                    {formatLearnChange(row.after)}
                  </a>
                </td>
                <td>{row.changed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>The tap is worth 0.3</h2>
      <p>
        <a href={LEARN_READ_CLICK_HREF} rel="noreferrer">
          ClickWeight
        </a>{" "}
        went from 0.4 to 0.3. A click here is the viewer tapping into your
        post. Same rule as{" "}
        <LegalLink href={LEARN_WEIGHTS_PATH} onNavigate={onWeights}>
          {LEARN_HEADING}
        </LegalLink>
        : 0.3 multiplies the predicted chance this viewer taps, not a count of
        taps.
      </p>

      <h2>The 10 seconds is in the code</h2>
      <p>
        <a href={LEARN_READ_CLICK_DWELL_HREF} rel="noreferrer">
          ContClickDwellTimeWeight
        </a>{" "}
        went from 0 to 0.4. It multiplies one model output,{" "}
        <code>click_dwell_time</code>, in the scorer:
      </p>
      <LearnCode file="xai-value-model/scoring.rs" href={LEARN_READ_APPLY_HREF}>
        {LEARN_READ_APPLY_SNIPPET}
      </LearnCode>
      <p>
        The name says “time”, so you might expect seconds. The training config
        says otherwise. Phoenix trains that head as a yes/no label with a{" "}
        <a href={LEARN_READ_LABEL_HREF} rel="noreferrer">
          10.0 threshold
        </a>
        , and the{" "}
        <a href={LEARN_READ_LABEL_ON_HREF} rel="noreferrer">
          loss weight is on
        </a>{" "}
        (1.0):
      </p>
      <LearnCode file="phoenix/xrex/configs/xrecsys.py" href={LEARN_READ_LABEL_HREF}>
        {LEARN_READ_LABEL_SNIPPET}
      </LearnCode>
      <p>
        The{" "}
        <a href={LEARN_READ_LOSS_HREF} rel="noreferrer">
          loss
        </a>{" "}
        turns the measured click-dwell into 1 only when it is strictly over
        the threshold, and the head outputs a sigmoid probability. Dwell is
        measured in{" "}
        <a href={LEARN_READ_SECONDS_HREF} rel="noreferrer">
          seconds
        </a>{" "}
        across Phoenix.
      </p>
      <LearnCode file="phoenix/xrex/models/loss_recsys.py" href={LEARN_READ_LOSS_HREF}>
        {LEARN_READ_LOSS_SNIPPET}
      </LearnCode>
      <p>
        So the new term is 0.4 × P(this viewer taps in and stays more than 10
        seconds). The 10 is real. It is the line the model learns, not a
        stopwatch on each reader.
      </p>
      <LearnTip title="Two predictions, not 0.7 points">
        <p>
          You will see “a tap plus a read is now worth 0.7”. Closer: the tap
          and the long read are two separate predictions for this viewer.
          Someone likely to tap and stay adds 0.3 × P(tap) + 0.4 × P(stay
          past 10 s). Someone likely to tap and bail mostly adds the 0.3 term,
          which is smaller than it was.
        </p>
      </LearnTip>
      <LearnTip title="What the repo does not show">
        <p>
          The repo publishes the training config and the default weights. It
          does not publish the served checkpoint. If X serves a model trained
          with a different threshold, the 0.4 still applies to whatever that
          head predicts. We cite what is in the repo.
        </p>
      </LearnTip>

      <h2>Not interested is −47.52</h2>
      <p>
        <a href={LEARN_READ_NOT_INTERESTED_HREF} rel="noreferrer">
          NotInterestedWeight
        </a>{" "}
        went from −43.2 to −47.52, exactly 10% heavier. It multiplies
        P(this viewer taps “not interested”). Block (−31.2), mute (−58.8) and
        report (−234.0) did not move.
      </p>

      <h2>Insults: one more drop, not everywhere</h2>
      <p>
        The same release added{" "}
        <a href={LEARN_READ_INSULT_RULE_HREF} rel="noreferrer">
          <code>FosnrAbuseInsultsNonFollower</code>
        </a>
        . A post with the insults label is dropped for viewers who do not
        follow you, at the{" "}
        <a href={LEARN_READ_INSULT_LEVEL_HREF} rel="noreferrer">
          home timeline hydration
        </a>{" "}
        level. The older rule already kept it out of recommendations.
      </p>
      <p>
        “Hidden from non-followers everywhere” overstates it. X's own test
        corpus still{" "}
        <a href={LEARN_READ_INSULT_CORPUS_HREF} rel="noreferrer">
          allows a non-follower
        </a>{" "}
        on the plain home timeline. The lesson is the same either way: an
        insult label now costs you strangers in one more place.
      </p>

      <h2>The fresh-post pool is built, not on</h2>
      <p>
        Phoenix now defines a{" "}
        <a href={LEARN_READ_COLD_POOL_HREF} rel="noreferrer">
          cold pool
        </a>
        : posts under 8 likes and under 500 views, up to 2 hours old. On 29
        September X deleted a rule that zeroed the scores of those candidates
        for most viewers. The source that feeds them is still{" "}
        <a href={LEARN_READ_MOE_SWITCH_HREF} rel="noreferrer">
          switched off
        </a>
        . Nothing to change in how you post until it turns on.
      </p>

      <h2>The small-account lift got wider</h2>
      <p>
        One day later,{" "}
        <a href={LEARN_READ_COLD_START_CHANGE_HREF} rel="noreferrer">
          <code>77d431a</code>
        </a>{" "}
        raised the cold-start{" "}
        <a href={LEARN_READ_COLD_START_CAP_HREF} rel="noreferrer">
          follower cap
        </a>{" "}
        from 1,000 to 50,000 and cut its post age from 48 hours to 2 hours.
        An eligible post can be placed at{" "}
        <a href={LEARN_READ_COLD_START_SLOT_HREF} rel="noreferrer">
          slot 15
        </a>{" "}
        (the 16th spot) for some viewers. Only{" "}
        <a href={LEARN_READ_COLD_START_ELIGIBLE_HREF} rel="noreferrer">
          originals
        </a>{" "}
        qualify, not replies or reposts.
      </p>
      <LearnTip title="Under 1,000 followers is out of date">
        <p>
          If you read “under 1,000 followers gets a lift”, that was the cap
          until 30 September. The window is now the first 2 hours of an
          original post.
        </p>
      </LearnTip>

      <h2>On your side of the reply</h2>
      <p>
        The 10 seconds is about <em>your readers</em> on <em>your</em> post.
        It ranks what you write. It is not a rule about how long you look at
        a post before you reply to it.
      </p>
      <p>
        Your own reading still matters, for a different reason. The spam
        model scores your action sequence. Its inputs include your{" "}
        <a href={LEARN_READ_BDSM_DWELL_HREF} rel="noreferrer">
          dwell-to-action ratio and the time from serve to action
        </a>
        , and{" "}
        <a href={LEARN_BDSM_REPLY_HEAD_HREF} rel="noreferrer">
          ReplySpamBot
        </a>{" "}
        has a label named <code>REPLY_SPAM_NO_CONSUMPTION</code>. No threshold
        for those is published. See{" "}
        <LegalLink href={LEARN_GIVE_PATH} onNavigate={onGive}>
          {LEARN_GIVE_HEADING}
        </LegalLink>
        .
      </p>
      <LearnTip title="Our habit, not X's number">
        <p>
          Open the post. Read the whole thing. Then reply. Ten seconds is a
          floor we picked because it matches the ranking label. It is not a
          number the spam model publishes. When you do read a post past 10
          seconds, that is the exact label its author is now paid for.
        </p>
      </LearnTip>

      <h2>Write for the read</h2>
      <p>
        The tap still counts. The read now counts more. Craft for both, in
        that order.
      </p>
      <ul>
        <li>Earn the tap honestly. The first line names what is inside.</li>
        <li>
          Pay it off below the fold: the number, the steps, the example, the
          screenshot worth studying.
        </li>
        <li>
          Skip bait that gets the tap and loses the reader. That is 0.3
          where it used to be 0.4, with nothing for the read.
        </li>
        <li>
          Do not post what your audience will hide. Not interested is now
          −47.52.
        </li>
        <li>
          Under 50,000 followers, the first 2 hours of an original are when
          the lift can apply.
        </li>
      </ul>

      <h2>Source</h2>
      <p>
        <a href={`${LEARN_SOURCE_REPO}/tree/${LEARN_READ_SHA}`} rel="noreferrer">
          xai-org/x-algorithm
        </a>{" "}
        at <code>{LEARN_READ_SHA}</code> ({LEARN_READ_DATE}). The weights
        changed in{" "}
        <a href={LEARN_READ_CHANGE_HREF} rel="noreferrer">
          <code>{LEARN_READ_CHANGE_SHA}</code>
        </a>
        . Feature switches still exist. If a number is not in this snapshot,
        we do not say it.
      </p>
      <p>{PRODUCT_NAME} is not affiliated with X Corp.</p>
      <p>
        Related:{" "}
        <LegalLink href={LEARN_WEIGHTS_PATH} onNavigate={onWeights}>
          {LEARN_HEADING}
        </LegalLink>
        .{" "}
        <LegalLink href={LEARN_GIVE_PATH} onNavigate={onGive}>
          {LEARN_GIVE_HEADING}
        </LegalLink>
        .
      </p>
    </LearnChrome>
  );
}
