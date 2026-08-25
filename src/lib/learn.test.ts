import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LEARN_FORMULA,
  LEARN_OON_HREF,
  LEARN_OON_SWITCH_HREF,
  LEARN_PARAM_COMMENT_HREF,
  LEARN_SOURCE_SHA,
  LEARN_WEIGHTS,
  algorithmPermalink,
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
});
