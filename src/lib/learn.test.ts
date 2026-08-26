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

  it("publishes two catalog lessons", () => {
    assert.equal(LEARN_LESSONS.length, 2);
    assert.equal(LEARN_LESSONS[0]!.href, LEARN_WEIGHTS_PATH);
    assert.equal(LEARN_LESSONS[1]!.href, LEARN_REPLY_PATH);
    assert.equal(LEARN_WEIGHTS_PATH, "/learn/what-a-like-is-worth");
    assert.equal(LEARN_REPLY_PATH, "/learn/posts-that-get-a-reply");
    assert.equal(LEARN_IMAGE, "/og-learn.png");
    assert.match(LEARN_HUB_TITLE, /Learn the X algorithm/);
    assert.match(LEARN_HUB_DESCRIPTION, /P\(action\)/);
    assert.match(LEARN_HUB_DESCRIPTION, /not affiliated/i);
    assert.match(LEARN_REPLY_DESCRIPTION, /P\(reply\)/);
    assert.match(LEARN_REPLY_DESCRIPTION, /not affiliated/i);
    assert.doesNotMatch(LEARN_REPLY_DESCRIPTION, /reply farming/i);
  });

  it("keeps official snippets verbatim", () => {
    assert.match(LEARN_APPLY_SNIPPET, /score\.unwrap_or\(0\.0\) \* weight/);
    assert.match(LEARN_PARAM_COMMENT_SNIPPET, /one report cancels 468 likes/);
    assert.match(LEARN_OON_SNIPPET, /deboost_in_network_replies_retweets/);
    assert.match(LEARN_REPLY_WEIGHT_SNIPPET, /reply_weight_for/);
    assert.match(LEARN_REPLY_WEIGHT_SNIPPET, /is_mutual_follow_author/);
  });
});
