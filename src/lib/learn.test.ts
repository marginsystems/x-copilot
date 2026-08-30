import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LEARN_APPLY_SNIPPET,
  LEARN_DRAWER_LEAD,
  LEARN_FOLLOW_META,
  LEARN_HUB_DESCRIPTION,
  LEARN_HUB_TITLE,
  LEARN_IMAGE,
  LEARN_LESSONS,
  LEARN_META,
  LEARN_REPLY_DESCRIPTION,
  LEARN_REPLY_PATH,
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
  LEARN_PHOENIX_FAV_HREF,
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

describe("learn citations", () => {
  it("pins every permalink to the cited SHA", () => {
    assert.equal(LEARN_SOURCE_SHA, "d011592");
    assert.match(LEARN_PARAM_COMMENT_HREF, /\/blob\/d011592\/home-mixer\/params\/param\.rs/);
    assert.match(LEARN_PARAM_COMMENT_HREF, /#L285-L313/);
    assert.equal(
      algorithmPermalink("home-mixer/scorers/ranking_scorer.rs", 447, 458),
      "https://github.com/xai-org/x-algorithm/blob/d011592/home-mixer/scorers/ranking_scorer.rs#L447-L458",
    );
  });

  it("ties the on-page date to LEARN_SOURCE_DATE", () => {
    assert.equal(LEARN_SOURCE_DATE, "2026-08-24");
    assert.equal(formatLearnSourceDate(LEARN_SOURCE_DATE), "24 August 2026");
    assert.match(LEARN_META, /24 August 2026/);
    assert.match(LEARN_FOLLOW_META, /24 August 2026/);
  });

  it("keeps the published defaults and does not invent extras", () => {
    assert.equal(LEARN_WEIGHTS.length, 14);
    const byParam = Object.fromEntries(LEARN_WEIGHTS.map((row) => [row.param, row.weight]));
    assert.equal(byParam.FavoriteWeight, 0.5);
    assert.equal(byParam.RetweetWeight, 1.0);
    assert.equal(byParam.ReplyWeight, 5.0);
    assert.equal(byParam.QuoteWeight, 5.0);
    assert.equal(byParam.FollowAuthorWeight, 4.0);
    assert.equal(byParam.ShareViaCopyLinkWeight, 20.0);
    assert.equal(byParam.ReportWeight, -234.0);
    assert.equal(byParam.MuteAuthorWeight, -58.8);
    for (const row of LEARN_WEIGHTS) {
      assert.match(weightPermalink(row), /\/blob\/d011592\/home-mixer\/params\/param\.rs#L/);
    }
  });

  it("prints signed defaults and the official formula", () => {
    assert.equal(formatLearnWeight(0.5), "+0.5");
    assert.equal(formatLearnWeight(-234.0), "-234.0");
    assert.equal(LEARN_FORMULA, "Final Score = Σ (weight_i × P(action_i))");
  });

  it("pins follow / OON citations to the same SHA", () => {
    assert.match(LEARN_OON_HREF, /\/blob\/d011592\/home-mixer\/params\/param\.rs#L252-L257/);
    assert.match(
      LEARN_OON_SWITCH_HREF,
      /EnableOonRescoreForInNetworkRepliesRetweets|#L266-L271/,
    );
    assert.match(LEARN_OON_SWITCH_HREF, /\/blob\/d011592\//);
  });

  it("keeps the Approach drawer to three cited sentences", () => {
    assert.match(LEARN_DRAWER_LEAD, /P\(action\)/);
    assert.doesNotMatch(LEARN_DRAWER_LEAD, /468 likes/);
    assert.match(LEARN_DRAWER_OON, /0\.75/);
    assert.match(LEARN_DRAWER_SOURCE, /d011592/);
    assert.match(LEARN_DRAWER_SOURCE, /not affiliated/i);
  });

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
      next: null,
    });
    assert.deepEqual(learnAdjacentLessons("learnFollow"), {
      prev: null,
      next: null,
    });
  });

  it("publishes four catalog lessons", () => {
    assert.equal(LEARN_LESSONS.length, 4);
    assert.equal(LEARN_LESSONS[0]!.href, LEARN_WEIGHTS_PATH);
    assert.equal(LEARN_LESSONS[1]!.href, LEARN_REPLY_PATH);
    assert.equal(LEARN_LESSONS[2]!.href, LEARN_VOLUME_PATH);
    assert.equal(LEARN_LESSONS[3]!.href, LEARN_GIVE_PATH);
    assert.equal(LEARN_WEIGHTS_PATH, "/learn/what-a-like-is-worth");
    assert.equal(LEARN_REPLY_PATH, "/learn/posts-that-get-a-reply");
    assert.equal(LEARN_VOLUME_PATH, "/learn/how-many-replies");
    assert.equal(LEARN_GIVE_PATH, "/learn/likes-and-follows-you-give");
    assert.equal(LEARN_IMAGE, "/og-learn.png");
    assert.equal(LEARN_GIVE_IMAGE, "/og-learn-give.png");
    assert.match(LEARN_HUB_TITLE, /Learn the X algorithm/);
    assert.match(LEARN_HUB_DESCRIPTION, /P\(action\)/);
    assert.match(LEARN_HUB_DESCRIPTION, /not affiliated/i);
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
    assert.match(LEARN_GIVE_DESCRIPTION, /not subtracted/);
    assert.match(LEARN_GIVE_DESCRIPTION, /LikeBot/);
    assert.match(LEARN_GIVE_DESCRIPTION, /FollowBot/);
    assert.match(LEARN_GIVE_DESCRIPTION, /EngagementAmplifier/);
    assert.match(LEARN_GIVE_DESCRIPTION, /10000 followed ids/);
    assert.match(LEARN_GIVE_DESCRIPTION, /redacted/);
    assert.match(LEARN_GIVE_DESCRIPTION, /not affiliated/i);
    assert.doesNotMatch(LEARN_GIVE_DESCRIPTION, /like everything to grow/i);
    assert.doesNotMatch(LEARN_GIVE_DESCRIPTION, /daily like/i);
    assert.doesNotMatch(LEARN_GIVE_DESCRIPTION, /hurts your reach/i);
    assert.doesNotMatch(LEARN_GIVE_DESCRIPTION, /follow everyone/i);
    assert.equal(
      LEARN_LESSONS[3]!.lede,
      "Your like is not a debit on your score. LikeBot and FollowBot score sequences. Thunder takes 10000 followed ids.",
    );
  });

  it("keeps official snippets verbatim", () => {
    assert.match(LEARN_APPLY_SNIPPET, /score\.unwrap_or\(0\.0\) \* weight/);
    assert.match(LEARN_PARAM_COMMENT_SNIPPET, /one report cancels 468 likes/);
    assert.match(LEARN_OON_SNIPPET, /deboost_in_network_replies_retweets/);
    assert.match(LEARN_REPLY_WEIGHT_SNIPPET, /reply_weight_for/);
    assert.match(LEARN_REPLY_WEIGHT_SNIPPET, /is_mutual_follow_author/);
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
  });

  it("pins volume citations and does not invent a daily quota", () => {
    assert.match(
      LEARN_DIVERSITY_FN_HREF,
      /\/blob\/d011592\/home-mixer\/scorers\/ranking_scorer\.rs#L643-L645/,
    );
    assert.match(LEARN_THUNDER_CAP_HREF, /\/blob\/d011592\/thunder\/config\.rs#L1-L6/);
    assert.match(LEARN_BDSM_HEADS_HREF, /\/blob\/d011592\/bdsm\/README\.md#L30-L34/);
    assert.match(LEARN_BDSM_ROPE_HREF, /\/blob\/d011592\/bdsm\/README\.md#L22-L24/);
    assert.match(LEARN_BDSM_FEATURES_HREF, /\/blob\/d011592\/bdsm\/README\.md#L26-L29/);
    assert.match(LEARN_BDSM_SEQ_HREF, /\/blob\/d011592\/bdsm\/README\.md#L102-L103/);
    assert.match(LEARN_BDSM_REDACT_HREF, /\/blob\/d011592\/bdsm\/README\.md#L104-L115/);
    assert.match(LEARN_BDSM_ACTION_HREF, /\/blob\/d011592\/bdsm\/README\.md#L63-L66/);
    assert.match(
      LEARN_BDSM_REPLY_HEAD_HREF,
      /\/blob\/d011592\/bdsm\/runtime\/heads\.py#L54-L63/,
    );
    assert.match(
      LEARN_BDSM_TWEET_HEAD_HREF,
      /\/blob\/d011592\/bdsm\/runtime\/heads\.py#L64-L73/,
    );
    assert.match(
      LEARN_BDSM_FOLLOW_HEAD_HREF,
      /\/blob\/d011592\/bdsm\/runtime\/heads\.py#L17-L28/,
    );
    assert.match(
      LEARN_BDSM_LIKE_HEAD_HREF,
      /\/blob\/d011592\/bdsm\/runtime\/heads\.py#L29-L39/,
    );
    assert.match(
      LEARN_BDSM_AMPLIFIER_HEAD_HREF,
      /\/blob\/d011592\/bdsm\/runtime\/heads\.py#L40-L53/,
    );
    assert.match(
      LEARN_BDSM_MULTI_HEAD_HREF,
      /\/blob\/d011592\/bdsm\/runtime\/heads\.py#L83-L98/,
    );
    assert.match(
      LEARN_THUNDER_FOLLOW_TAKE_HREF,
      /\/blob\/d011592\/thunder\/thunder_service\.rs#L232-L242/,
    );
    assert.match(
      LEARN_PHOENIX_FAV_HREF,
      /\/blob\/d011592\/phoenix\/README\.md#L274-L275/,
    );
    assert.equal(learnDiversityMultiplier(0), 1);
    assert.equal(learnDiversityMultiplier(1), 0.625);
    assert.equal(learnDiversityMultiplier(2), 0.4375);
    assert.equal(learnDiversityMultiplier(3), 0.34375);
  });
});
