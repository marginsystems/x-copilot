/**
 * Cited defaults from xai-org/x-algorithm @ d011592.
 * Every public number is a permalink. Do not invent extras.
 */

export const LEARN_SOURCE_SHA = "d011592";
export const LEARN_SOURCE_DATE = "2026-08-24";
export const LEARN_SOURCE_REPO = "https://github.com/xai-org/x-algorithm";

export const LEARN_TITLE = "What a like is worth — x-copilot";
export const LEARN_HEADING = "What a like is worth";
export const LEARN_DESCRIPTION =
  "X For You ranking weights multiply P(action) for this viewer, not raw likes or reports. Defaults from xai-org/x-algorithm at d011592. Not affiliated with X Corp.";
export const LEARN_META =
  "Cited from xai-org/x-algorithm at d011592 (24 August 2026). Defaults in this snapshot. Not affiliated with X Corp.";

export const LEARN_FOLLOW_TITLE = "Follow and out-of-network — x-copilot";
export const LEARN_FOLLOW_HEADING = "Follow and out-of-network";
export const LEARN_FOLLOW_DESCRIPTION =
  "X For You in-network posts come from thunder/. Out-of-network posts, and followed replies or reposts, are multiplied by 0.75. Follow-author is +4.0. Defaults from xai-org/x-algorithm at d011592. Not affiliated with X Corp.";
export const LEARN_FOLLOW_META =
  "Cited from xai-org/x-algorithm at d011592 (24 August 2026). Defaults in this snapshot. Not affiliated with X Corp.";

export const LEARN_FORMULA = "Final Score = Σ (weight_i × P(action_i))";

export type LearnWeight = {
  action: string;
  weight: number;
  param: string;
  startLine: number;
  endLine: number;
};

/** Defaults in home-mixer/params/param.rs at LEARN_SOURCE_SHA. */
export const LEARN_WEIGHTS: LearnWeight[] = [
  { action: "Favorite (like)", weight: 0.5, param: "FavoriteWeight", startLine: 314, endLine: 314 },
  { action: "Retweet", weight: 1.0, param: "RetweetWeight", startLine: 328, endLine: 328 },
  { action: "Click", weight: 0.4, param: "ClickWeight", startLine: 341, endLine: 341 },
  { action: "Share", weight: 2.0, param: "ShareWeight", startLine: 350, endLine: 350 },
  { action: "Follow author", weight: 4.0, param: "FollowAuthorWeight", startLine: 377, endLine: 382 },
  { action: "Reply", weight: 5.0, param: "ReplyWeight", startLine: 315, endLine: 315 },
  { action: "Quote", weight: 5.0, param: "QuoteWeight", startLine: 364, endLine: 364 },
  { action: "Share via DM", weight: 5.0, param: "ShareViaDmWeight", startLine: 351, endLine: 356 },
  {
    action: "Share via copy link",
    weight: 20.0,
    param: "ShareViaCopyLinkWeight",
    startLine: 357,
    endLine: 362,
  },
  {
    action: "Mutual-follow reply boost",
    weight: 15.0,
    param: "BidirectionalFollowReplyWeightBoost",
    startLine: 316,
    endLine: 321,
  },
  {
    action: "Not interested",
    weight: -43.2,
    param: "NotInterestedWeight",
    startLine: 456,
    endLine: 461,
  },
  {
    action: "Block author",
    weight: -31.2,
    param: "BlockAuthorWeight",
    startLine: 462,
    endLine: 467,
  },
  {
    action: "Mute author",
    weight: -58.8,
    param: "MuteAuthorWeight",
    startLine: 468,
    endLine: 473,
  },
  { action: "Report", weight: -234.0, param: "ReportWeight", startLine: 474, endLine: 474 },
];

export function algorithmPermalink(
  path: string,
  startLine?: number,
  endLine?: number,
): string {
  const base = `${LEARN_SOURCE_REPO}/blob/${LEARN_SOURCE_SHA}/${path}`;
  if (startLine == null) return base;
  if (endLine == null || endLine === startLine) return `${base}#L${startLine}`;
  return `${base}#L${startLine}-L${endLine}`;
}

export const LEARN_PARAM_COMMENT_HREF = algorithmPermalink(
  "home-mixer/params/param.rs",
  285,
  313,
);
export const LEARN_PARAM_FILE_HREF = algorithmPermalink("home-mixer/params/param.rs");
export const LEARN_SCORER_HREF = algorithmPermalink(
  "home-mixer/scorers/ranking_scorer.rs",
  447,
  458,
);
export const LEARN_README_SCORE_HREF = algorithmPermalink("README.md", 337, 338);
export const LEARN_OON_HREF = algorithmPermalink("home-mixer/params/param.rs", 252, 257);
export const LEARN_OON_SWITCH_HREF = algorithmPermalink(
  "home-mixer/params/param.rs",
  266,
  271,
);
export const LEARN_OON_APPLY_HREF = algorithmPermalink(
  "home-mixer/scorers/ranking_scorer.rs",
  805,
  816,
);
export const LEARN_FOLLOW_AUTHOR_HREF = algorithmPermalink(
  "home-mixer/params/param.rs",
  377,
  382,
);
export const LEARN_MUTUAL_REPLY_HREF = algorithmPermalink(
  "home-mixer/params/param.rs",
  316,
  321,
);
export const LEARN_MUTUAL_REPLY_APPLY_HREF = algorithmPermalink(
  "home-mixer/scorers/ranking_scorer.rs",
  180,
  192,
);
export const LEARN_THUNDER_HREF = algorithmPermalink("README.md", 60, 63);
export const LEARN_DIVERSITY_HREF = algorithmPermalink(
  "home-mixer/params/param.rs",
  228,
  239,
);

export function formatLearnWeight(weight: number): string {
  const sign = weight > 0 ? "+" : "";
  return `${sign}${weight.toFixed(1)}`;
}

export function weightPermalink(row: LearnWeight): string {
  return algorithmPermalink("home-mixer/params/param.rs", row.startLine, row.endLine);
}
