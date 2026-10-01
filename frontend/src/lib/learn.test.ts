import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LEARN_APPLY_SNIPPET,
  LEARN_DRAWER_LEAD,
  LEARN_FOLLOW_META,
  LEARN_FOLLOW_IMAGE,
  LEARN_HUB_DESCRIPTION,
  LEARN_HUB_LEDE,
  LEARN_HUB_TITLE,
  LEARN_IMAGE,
  LEARN_LESSONS,
  LEARN_META,
  LEARN_REPLY_DESCRIPTION,
  LEARN_REPLY_PATH,
  LEARN_REPLY_ELIGIBLE_SNIPPET,
  LEARN_REPLY_WEIGHT_SNIPPET,
  LEARN_VOLUME_DESCRIPTION,
  LEARN_VOLUME_PATH,
  LEARN_BDSM_AMPLIFIER_HEAD_HREF,
  LEARN_BDSM_AMPLIFIER_HEAD_SNIPPET,
  LEARN_BDSM_FOLLOW_HEAD_HREF,
  LEARN_BDSM_FOLLOW_HEAD_SNIPPET,
  LEARN_BDSM_LIKE_HEAD_HREF,
  LEARN_BDSM_LIKE_HEAD_SNIPPET,
  LEARN_BDSM_MULTI_HEAD_HREF,
  LEARN_GIVE_DESCRIPTION,
  LEARN_GIVE_IMAGE,
  LEARN_GIVE_PATH,
  LEARN_READ_CHANGES,
  LEARN_READ_CHANGE_SNIPPET,
  LEARN_READ_CLICK_DWELL_HREF,
  LEARN_READ_CLICK_HREF,
  LEARN_READ_DESCRIPTION,
  LEARN_READ_LABEL_HREF,
  LEARN_READ_LABEL_SNIPPET,
  LEARN_READ_LOSS_SNIPPET,
  LEARN_READ_NOT_INTERESTED_HREF,
  LEARN_READ_PATH,
  LEARN_REPLY_IMAGE,
  LEARN_VOLUME_IMAGE,
  LEARN_WEIGHTS_IMAGE,
  LEARN_PHOENIX_FAV_HREF,
  LEARN_BDSM_COOLDOWN_HREF,
  LEARN_RANKING_VISIBILITY_HREF,
  LEARN_UTH_HREF,
  LEARN_THUNDER_FOLLOW_TAKE_HREF,
  LEARN_THUNDER_FOLLOW_TAKE_SNIPPET,
  LEARN_DIVERSITY_FN_HREF,
  LEARN_DIVERSITY_SNIPPET,
  LEARN_THUNDER_CAP_HREF,
  LEARN_THUNDER_CAP_SNIPPET,
  LEARN_BDSM_ACTION_HREF,
  LEARN_BDSM_FEATURES_HREF,
  LEARN_BDSM_HEADS_HREF,
  LEARN_BDSM_REDACT_HREF,
  LEARN_BDSM_REPLY_HEAD_HREF,
  LEARN_BDSM_REPLY_HEAD_SNIPPET,
  LEARN_BDSM_ROPE_HREF,
  LEARN_BDSM_SEQ_HREF,
  LEARN_BDSM_SINK_ENFORCE_HREF,
  LEARN_BDSM_SINK_LIVENESS_HREF,
  LEARN_BDSM_TWEET_HEAD_HREF,
  LEARN_BDSM_TWEET_HEAD_SNIPPET,
  learnAdjacentLessons,
  learnDiversityMultiplier,
  LEARN_WEIGHTS_PATH,
  LEARN_OON_SNIPPET,
  LEARN_PARAM_COMMENT_SNIPPET,
  LEARN_DRAWER_OON,
  LEARN_DRAWER_SOURCE,
  LEARN_FORMULA,
  LEARN_OON_HREF,
  LEARN_OON_SWITCH_HREF,
  LEARN_PARAM_COMMENT_HREF,
  LEARN_SOURCE_DATE,
  LEARN_SOURCE_SHA,
  LEARN_WEIGHTS,
  algorithmPermalink,
  formatLearnSourceDate,
  formatLearnWeight,
  weightPermalink,
} from "./learn.ts";

await describe("learn citations", () => {
  it("pins every permalink to the cited SHA", () => {
    assert.equal(LEARN_SOURCE_SHA, "b79b947");
    assert.match(LEARN_PARAM_COMMENT_HREF, /\/blob\/b79b947\/home-mixer\/params\/param\.rs/);
    assert.match(LEARN_PARAM_COMMENT_HREF, /#L273-L301/);
    assert.equal(
      algorithmPermalink("xai-value-model/scoring.rs", 57, 59),
      "https://github.com/xai-org/x-algorithm/blob/b79b947/xai-value-model/scoring.rs#L57-L59",
    );
  }).catch(assert.fail);

  it("ties the on-page date to LEARN_SOURCE_DATE", () => {
    assert.equal(LEARN_SOURCE_DATE, "2026-10-01");
    assert.equal(formatLearnSourceDate(LEARN_SOURCE_DATE), "1 October 2026");
    assert.match(LEARN_META, /1 October 2026/);
    assert.match(LEARN_FOLLOW_META, /1 October 2026/);
  }).catch(assert.fail);

  it("keeps the published defaults and does not invent extras", () => {
    assert.equal(LEARN_WEIGHTS.length, 15);
    const byParam = Object.fromEntries(LEARN_WEIGHTS.map((row) => [row.param, row.weight]));
    assert.equal(byParam.FavoriteWeight, 0.5);
    assert.equal(byParam.RetweetWeight, 1.0);
    assert.equal(byParam.ReplyWeight, 5.0);
    assert.equal(byParam.QuoteWeight, 5.0);
    assert.equal(byParam.FollowAuthorWeight, 4.0);
    assert.equal(byParam.ShareViaCopyLinkWeight, 20.0);
    assert.equal(byParam.ReportWeight, -234.0);
    assert.equal(byParam.MuteAuthorWeight, -58.8);
    assert.equal(byParam.ClickWeight, 0.3);
    assert.equal(byParam.ContClickDwellTimeWeight, 0.4);
    assert.equal(byParam.NotInterestedWeight, -47.52);
    for (const row of LEARN_WEIGHTS) {
      assert.match(weightPermalink(row), /\/blob\/b79b947\/home-mixer\/params\/param\.rs#L/);
    }
  }).catch(assert.fail);

  it("prints signed defaults and the official formula", () => {
    assert.equal(formatLearnWeight(0.5), "+0.5");
    assert.equal(formatLearnWeight(-234.0), "-234.0");
    assert.equal(formatLearnWeight(-47.52), "-47.52");
    assert.equal(formatLearnWeight(0.004), "+0.004");
    assert.equal(LEARN_FORMULA, "Final Score = Σ (weight_i × P(action_i))");
  }).catch(assert.fail);

  it("pins follow / OON citations to the same SHA", () => {
    assert.match(LEARN_OON_HREF, /\/blob\/b79b947\/vm-ranker\/params\.rs#L175-L180/);
    assert.match(LEARN_OON_SWITCH_HREF, /\/vm-ranker\/params\.rs#L157-L162/);
    assert.match(LEARN_OON_SWITCH_HREF, /\/blob\/b79b947\//);
  }).catch(assert.fail);

  it("keeps the Approach drawer to three cited sentences", () => {
    assert.match(LEARN_DRAWER_LEAD, /P\(action\)/);
    assert.doesNotMatch(LEARN_DRAWER_LEAD, /468 likes/);
    assert.match(LEARN_DRAWER_OON, /0\.75/);
    assert.match(LEARN_DRAWER_SOURCE, /b79b947/);
    assert.match(LEARN_DRAWER_SOURCE, /not affiliated/i);
  }).catch(assert.fail);

  it("walks catalog lessons in published order", () => {
    assert.deepEqual(learnAdjacentLessons("learnWeights"), {
      prev: null,
      next: LEARN_LESSONS[1],
    });
    assert.deepEqual(learnAdjacentLessons("learnReply"), {
      prev: LEARN_LESSONS[0],
      next: LEARN_LESSONS[2],
    });
    assert.deepEqual(learnAdjacentLessons("learnVolume"), {
      prev: LEARN_LESSONS[1],
      next: LEARN_LESSONS[3],
    });
    assert.deepEqual(learnAdjacentLessons("learnGive"), {
      prev: LEARN_LESSONS[2],
      next: LEARN_LESSONS[4],
    });
    assert.deepEqual(learnAdjacentLessons("learnRead"), {
      prev: LEARN_LESSONS[3],
      next: null,
    });
    assert.deepEqual(learnAdjacentLessons("learnFollow"), {
      prev: null,
      next: null,
    });
  }).catch(assert.fail);

  it("publishes five catalog lessons", () => {
    assert.equal(LEARN_LESSONS.length, 5);
    assert.equal(LEARN_LESSONS[4]!.href, LEARN_READ_PATH);
    assert.equal(LEARN_READ_PATH, "/learn/the-read-beats-the-tap");
    assert.equal(LEARN_LESSONS[0]!.href, LEARN_WEIGHTS_PATH);
    assert.equal(LEARN_LESSONS[1]!.href, LEARN_REPLY_PATH);
    assert.equal(LEARN_LESSONS[2]!.href, LEARN_VOLUME_PATH);
    assert.equal(LEARN_LESSONS[3]!.href, LEARN_GIVE_PATH);
    assert.equal(LEARN_WEIGHTS_PATH, "/learn/what-a-like-is-worth");
    assert.equal(LEARN_REPLY_PATH, "/learn/posts-that-get-a-reply");
    assert.equal(LEARN_VOLUME_PATH, "/learn/how-many-replies");
    assert.equal(LEARN_GIVE_PATH, "/learn/likes-and-follows-you-give");
    assert.equal(LEARN_IMAGE, "/og-learn.png");
    assert.equal(LEARN_FOLLOW_IMAGE, LEARN_IMAGE);
    assert.equal(LEARN_GIVE_IMAGE, "/og-learn-give.png");
    assert.equal(LEARN_WEIGHTS_IMAGE, "/og-learn-weights.png");
    assert.equal(LEARN_REPLY_IMAGE, "/og-learn-reply.png");
    assert.equal(LEARN_VOLUME_IMAGE, "/og-learn-volume.png");
    assert.match(LEARN_HUB_TITLE, /Learn the X algorithm/);
    assert.match(LEARN_HUB_DESCRIPTION, /Cited lessons/);
    assert.match(LEARN_HUB_DESCRIPTION, /P\(action\)/);
    assert.match(LEARN_HUB_DESCRIPTION, /not affiliated/i);
    assert.match(LEARN_HUB_LEDE, /Five cited lessons/);
    assert.match(LEARN_HUB_LEDE, /Not a blog/);
    assert.match(LEARN_REPLY_DESCRIPTION, /P\(reply\)/);
    assert.match(LEARN_REPLY_DESCRIPTION, /not affiliated/i);
    assert.doesNotMatch(LEARN_REPLY_DESCRIPTION, /reply farming/i);
    assert.match(LEARN_VOLUME_DESCRIPTION, /no daily/);
    assert.match(LEARN_VOLUME_DESCRIPTION, /does not subtract/);
    assert.match(LEARN_VOLUME_DESCRIPTION, /not affiliated/i);
    assert.match(LEARN_VOLUME_DESCRIPTION, /one viewer's slate/);
    assert.match(LEARN_VOLUME_DESCRIPTION, /0\.5/);
    assert.match(LEARN_VOLUME_DESCRIPTION, /0\.25/);
    assert.match(LEARN_VOLUME_DESCRIPTION, /at most 30 replies/);
    assert.match(LEARN_VOLUME_DESCRIPTION, /ReplySpamBot/);
    assert.match(LEARN_VOLUME_DESCRIPTION, /TweetSpamBot/);
    assert.match(LEARN_VOLUME_DESCRIPTION, /redacted/);
    assert.doesNotMatch(LEARN_VOLUME_DESCRIPTION, /50 a day/i);
    assert.doesNotMatch(LEARN_VOLUME_DESCRIPTION, /30 a day/i);
    assert.doesNotMatch(LEARN_VOLUME_DESCRIPTION, /lose points/i);
    assert.doesNotMatch(LEARN_VOLUME_DESCRIPTION, /without throttl/i);
    assert.doesNotMatch(LEARN_VOLUME_DESCRIPTION, /safe daily/i);
    assert.equal(
      LEARN_LESSONS[2]!.lede,
      "0.5 and 0.25 are this viewer's slate. Thunder's 30 is a fetch cap. ReplySpamBot scores sequences.",
    );
    assert.match(LEARN_GIVE_DESCRIPTION, /do not like the parent/);
    assert.match(LEARN_GIVE_DESCRIPTION, /redacted/);
    assert.match(LEARN_GIVE_DESCRIPTION, /not subtracted/);
    assert.equal(
      LEARN_LESSONS[3]!.lede,
      "Eight spam heads, not For You. Reply-only is ReplySpamBot. Ramp and decay stay theory. Do not like or auto-follow who you reply to. Fire lines stay redacted. A like you give is not a For You debit.",
    );
    assert.equal(LEARN_LESSONS[3]!.href, LEARN_GIVE_PATH);
  }).catch(assert.fail);

  it("keeps official snippets verbatim", () => {
    assert.match(LEARN_APPLY_SNIPPET, /score\.unwrap_or\(0\.0\) \* weight/);
    assert.match(LEARN_PARAM_COMMENT_SNIPPET, /one report cancels 468 likes/);
    assert.match(LEARN_OON_SNIPPET, /oon_rescore_in_network_replies_retweets/);
    assert.match(LEARN_REPLY_WEIGHT_SNIPPET, /reply_weight_for/);
    assert.match(LEARN_REPLY_ELIGIBLE_SNIPPET, /is_mutual_follow_author/);
    assert.match(LEARN_DIVERSITY_SNIPPET, /decay_factor\.powf\(exponent\)/);
    assert.match(LEARN_THUNDER_CAP_SNIPPET, /MAX_REPLY_POSTS_PER_AUTHOR: usize = 30/);
    assert.match(LEARN_THUNDER_CAP_SNIPPET, /MAX_ORIGINAL_POSTS_PER_AUTHOR: usize = 50/);
    assert.match(LEARN_BDSM_REPLY_HEAD_SNIPPET, /REPLY_SPAM_NO_CONSUMPTION/);
    assert.match(LEARN_BDSM_REPLY_HEAD_SNIPPET, /CONVERSATION_SPAMMER/);
    assert.match(LEARN_BDSM_TWEET_HEAD_SNIPPET, /TWEET_CREATE_BURST/);
    assert.match(LEARN_BDSM_TWEET_HEAD_SNIPPET, /QUOTE_TWEET_SPAMMER/);
    assert.doesNotMatch(LEARN_BDSM_REPLY_HEAD_SNIPPET, /FOLLOW_UNFOLLOW_CYCLE/);
    assert.doesNotMatch(LEARN_BDSM_TWEET_HEAD_SNIPPET, /REPLY_SPAM_BOT/);
    assert.match(LEARN_BDSM_FOLLOW_HEAD_SNIPPET, /FOLLOW_UNFOLLOW_CYCLE/);
    assert.match(LEARN_BDSM_FOLLOW_HEAD_SNIPPET, /FOLLOW_FARM_BOT/);
    assert.match(LEARN_BDSM_LIKE_HEAD_SNIPPET, /STEADY_LIKE_DRIP/);
    assert.match(LEARN_BDSM_LIKE_HEAD_SNIPPET, /LIKE_FARM_BOT/);
    assert.match(LEARN_BDSM_AMPLIFIER_HEAD_SNIPPET, /REPLY_THEN_FOLLOW_PIPELINE/);
    assert.match(LEARN_BDSM_AMPLIFIER_HEAD_SNIPPET, /FOLLOW_LIKE_AMPLIFIER/);
    assert.match(LEARN_THUNDER_FOLLOW_TAKE_SNIPPET, /take\(MAX_INPUT_LIST_SIZE\)/);
    assert.match(LEARN_THUNDER_FOLLOW_TAKE_SNIPPET, /Limiting following_user_ids/);
  }).catch(assert.fail);

  it("pins volume citations and does not invent a daily quota", () => {
    assert.match(
      LEARN_DIVERSITY_FN_HREF,
      /\/blob\/b79b947\/xai-value-model\/scoring\.rs#L143-L145/,
    );
    assert.match(LEARN_THUNDER_CAP_HREF, /\/blob\/b79b947\/thunder\/config\.rs#L1-L6/);
    assert.match(LEARN_BDSM_HEADS_HREF, /\/blob\/b79b947\/bdsm\/README\.md#L30-L34/);
    assert.match(LEARN_BDSM_ROPE_HREF, /\/blob\/b79b947\/bdsm\/README\.md#L22-L24/);
    assert.match(LEARN_BDSM_FEATURES_HREF, /\/blob\/b79b947\/bdsm\/README\.md#L26-L29/);
    assert.match(LEARN_BDSM_SEQ_HREF, /\/blob\/b79b947\/bdsm\/README\.md#L102-L103/);
    assert.match(LEARN_BDSM_REDACT_HREF, /\/blob\/b79b947\/bdsm\/README\.md#L104-L115/);
    assert.match(LEARN_BDSM_ACTION_HREF, /\/blob\/b79b947\/bdsm\/README\.md#L63-L66/);
    assert.match(
      LEARN_BDSM_REPLY_HEAD_HREF,
      /\/blob\/b79b947\/bdsm\/runtime\/heads\.py#L54-L63/,
    );
    assert.match(
      LEARN_BDSM_TWEET_HEAD_HREF,
      /\/blob\/b79b947\/bdsm\/runtime\/heads\.py#L64-L73/,
    );
    assert.match(
      LEARN_BDSM_FOLLOW_HEAD_HREF,
      /\/blob\/b79b947\/bdsm\/runtime\/heads\.py#L17-L28/,
    );
    assert.match(
      LEARN_BDSM_LIKE_HEAD_HREF,
      /\/blob\/b79b947\/bdsm\/runtime\/heads\.py#L29-L39/,
    );
    assert.match(
      LEARN_BDSM_AMPLIFIER_HEAD_HREF,
      /\/blob\/b79b947\/bdsm\/runtime\/heads\.py#L40-L53/,
    );
    assert.match(
      LEARN_BDSM_MULTI_HEAD_HREF,
      /\/blob\/b79b947\/bdsm\/runtime\/heads\.py#L83-L98/,
    );
    assert.match(
      LEARN_BDSM_SINK_ENFORCE_HREF,
      /\/blob\/b79b947\/bdsm\/runtime\/sink_policy\.yaml#L16-L20/,
    );
    assert.match(
      LEARN_BDSM_SINK_LIVENESS_HREF,
      /\/blob\/b79b947\/bdsm\/runtime\/sink_policy\.yaml#L26-L28/,
    );
    assert.match(
      LEARN_THUNDER_FOLLOW_TAKE_HREF,
      /\/blob\/b79b947\/thunder\/thunder_service\.rs#L232-L242/,
    );
    assert.match(
      LEARN_PHOENIX_FAV_HREF,
      /\/blob\/b79b947\/phoenix\/README\.md#L274-L275/,
    );
    assert.match(
      LEARN_BDSM_COOLDOWN_HREF,
      /\/blob\/b79b947\/bdsm\/runtime\/score_results_sink_focal\.py#L344-L357/,
    );
    assert.match(
      LEARN_UTH_HREF,
      /\/blob\/b79b947\/README\.md#L446-L450/,
    );
    assert.match(
      LEARN_RANKING_VISIBILITY_HREF,
      /\/blob\/b79b947\/README\.md#L472-L474/,
    );
    assert.equal(learnDiversityMultiplier(0), 1);
    assert.equal(learnDiversityMultiplier(1), 0.625);
    assert.equal(learnDiversityMultiplier(2), 0.4375);
    assert.equal(learnDiversityMultiplier(3), 0.34375);
  }).catch(assert.fail);

  it("pins the read lesson to the commit that moved the weights", () => {
    const byParam = Object.fromEntries(
      LEARN_READ_CHANGES.map((row) => [row.param, [row.before, row.after]]),
    );
    assert.deepEqual(byParam.ClickWeight, [0.4, 0.3]);
    assert.deepEqual(byParam.ContClickDwellTimeWeight, [0, 0.4]);
    assert.deepEqual(byParam.NotInterestedWeight, [-43.2, -47.52]);
    assert.deepEqual(byParam.VqvWeight, [0.05, 0]);
    for (const row of LEARN_READ_CHANGES) {
      assert.match(row.beforeHref, /\/blob\/d011592\/home-mixer\/params\/param\.rs#L/);
      assert.match(row.afterHref, /\/blob\/b79b947\/home-mixer\/params\/param\.rs#L/);
    }
    assert.match(LEARN_READ_CLICK_HREF, /\/blob\/b79b947\/home-mixer\/params\/param\.rs#L329$/);
    assert.match(LEARN_READ_CLICK_DWELL_HREF, /\/blob\/b79b947\/home-mixer\/params\/param\.rs#L383-L388$/);
    assert.match(LEARN_READ_NOT_INTERESTED_HREF, /#L390-L395$/);
    assert.match(LEARN_READ_LABEL_HREF, /\/blob\/b79b947\/phoenix\/xrex\/configs\/xrecsys\.py#L691-L698$/);
    assert.match(LEARN_READ_LABEL_SNIPPET, /CLICK_DWELL_TIME/);
    assert.match(LEARN_READ_LABEL_SNIPPET, /binary_threshold=10\.0/);
    assert.match(LEARN_READ_LOSS_SNIPPET, /> threshold/);
    assert.match(LEARN_READ_CHANGE_SNIPPET, /-    -43\.2\n\+    -47\.52/);
    assert.match(LEARN_READ_DESCRIPTION, /10 seconds/);
    assert.match(LEARN_READ_DESCRIPTION, /P\(action\)/);
    assert.match(LEARN_READ_DESCRIPTION, /not affiliated/i);
    assert.equal(
      LEARN_LESSONS[4]!.lede,
      "The tap fell from 0.4 to 0.3. Staying past 10 seconds after it is a new 0.4. Not interested is now −47.52.",
    );
  }).catch(assert.fail);
});
