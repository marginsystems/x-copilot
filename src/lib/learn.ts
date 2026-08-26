/**
 * Cited defaults from xai-org/x-algorithm @ d011592.
 * Every public number is a permalink. Do not invent extras.
 */

export const LEARN_SOURCE_SHA = "d011592";
export const LEARN_SOURCE_DATE = "2026-08-24";
export const LEARN_SOURCE_REPO = "https://github.com/xai-org/x-algorithm";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatLearnSourceDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${MONTH_NAMES[(month ?? 1) - 1]} ${year}`;
}

export const LEARN_SOURCE_DATE_LABEL = formatLearnSourceDate(LEARN_SOURCE_DATE);

export const LEARN_HUB_TITLE = "Learn the X algorithm — x-copilot";
export const LEARN_HUB_HEADING = "Learn";
export const LEARN_HUB_DESCRIPTION =
  "Cited notes on how X For You ranks posts. Weights multiply P(action), not raw likes. From xai-org/x-algorithm at d011592. Not affiliated with X Corp.";
export const LEARN_HUB_META = `Cited from xai-org/x-algorithm at d011592 (${LEARN_SOURCE_DATE_LABEL}). Defaults in this snapshot. Not affiliated with X Corp.`;

export const LEARN_TITLE = "What a like is worth — x-copilot";
export const LEARN_HEADING = "What a like is worth";
export const LEARN_DESCRIPTION =
  "X For You ranking weights multiply P(action) for this viewer, not raw likes or reports. Defaults from xai-org/x-algorithm at d011592. Not affiliated with X Corp.";
export const LEARN_META = `Cited from xai-org/x-algorithm at d011592 (${LEARN_SOURCE_DATE_LABEL}). Defaults in this snapshot. Not affiliated with X Corp.`;
export const LEARN_WEIGHTS_PATH = "/learn/what-a-like-is-worth";

export const LEARN_FOLLOW_TITLE = "Follow and out-of-network — x-copilot";
export const LEARN_FOLLOW_HEADING = "Follow and out-of-network";
export const LEARN_FOLLOW_DESCRIPTION =
  "X For You in-network posts come from thunder/. Out-of-network posts, and followed replies or reposts, are multiplied by 0.75. Follow-author is +4.0. Defaults from xai-org/x-algorithm at d011592. Not affiliated with X Corp.";
export const LEARN_FOLLOW_META = `Cited from xai-org/x-algorithm at d011592 (${LEARN_SOURCE_DATE_LABEL}). Defaults in this snapshot. Not affiliated with X Corp.`;

export const LEARN_DRAWER_HEADING = "How ranking works";
export const LEARN_DRAWER_LEAD =
  "X For You multiplies each weight by P(action) for this viewer, not raw likes or reports.";
export const LEARN_DRAWER_OON =
  "Out-of-network posts, and followed replies or reposts, are then multiplied by 0.75.";
export const LEARN_DRAWER_SOURCE =
  "Defaults from xai-org/x-algorithm at d011592. Not affiliated with X Corp.";

export const LEARN_FORMULA = "Final Score = Σ (weight_i × P(action_i))";

/** Official snippets at LEARN_SOURCE_SHA. Do not rewrite the math. */
export const LEARN_APPLY_SNIPPET = `fn apply(score: Option<f64>, weight: f64) -> f64 {
    score.unwrap_or(0.0) * weight
}`;

export const LEARN_PARAM_COMMENT_SNIPPET = `// Each weight multiplies the *predicted* probability of that
// action (P(favorite), P(repost), …) or a continuous value e.g.
// watch time -- the weights do not multiply raw engagement counts.
// One common misinterpretation is that you can read these weight
// ratios as count equivalences, e.g. the incorrect statement that
// "one report cancels 468 likes" -- this is incorrect because the
// weights apply to the predicted probabilities rather than raw counts.`;

export const LEARN_REPLY_WEIGHT_SNIPPET = `fn bidirectional_boost_eligible(candidate: &PostCandidate) -> bool {
    candidate.in_reply_to_tweet_id.is_none()
        && candidate.retweeted_tweet_id.is_none()
        && candidate.is_mutual_follow_author == Some(true)
}

fn reply_weight_for(&self, candidate: &PostCandidate) -> f64 {
    if self.bidirectional_follow_reply_weight_boost != 0.0
        && Self::bidirectional_boost_eligible(candidate)
    {
        return self.reply + self.bidirectional_follow_reply_weight_boost;
    }
    self.reply
}`;

export const LEARN_OON_SNIPPET = `let oon_applies = |c: &PostCandidate| match c.in_network {
    Some(false) => true,
    Some(true) => {
        deboost_in_network_replies_retweets
            && (c.in_reply_to_tweet_id.is_some() || c.retweeted_tweet_id.is_some())
    }
    None => false,
};`;

export const LEARN_REPLY_TITLE = "Posts that get a reply — x-copilot";
export const LEARN_REPLY_HEADING = "Posts that get a reply";
export const LEARN_REPLY_DESCRIPTION =
  "X For You reply weight is +5.0. Mutual-follow originals add +15.0. Both multiply P(reply), not raw replies. Craft that invites a reply. Defaults from xai-org/x-algorithm at d011592. Not affiliated with X Corp.";
export const LEARN_REPLY_META = `Cited from xai-org/x-algorithm at d011592 (${LEARN_SOURCE_DATE_LABEL}). Defaults in this snapshot. Not affiliated with X Corp.`;
export const LEARN_REPLY_PATH = "/learn/posts-that-get-a-reply";

export const LEARN_FOLLOW_PATH = "/learn/follow";

export const LEARN_IMAGE = "/og-learn.png";
export const LEARN_IMAGE_ALT =
  "x-copilot Learn — ranking weights on a dark field";

export type LearnLessonView = "learnWeights" | "learnReply";

export type LearnLesson = {
  view: LearnLessonView;
  href: string;
  number: string;
  heading: string;
  lede: string;
};

/** Published catalog cards. Follow stays a related note, not a catalog lesson. */
export const LEARN_LESSONS: readonly LearnLesson[] = [
  {
    view: "learnWeights",
    href: LEARN_WEIGHTS_PATH,
    number: "01",
    heading: LEARN_HEADING,
    lede: "Weights multiply P(action), not raw likes or reports.",
  },
  {
    view: "learnReply",
    href: LEARN_REPLY_PATH,
    number: "02",
    heading: LEARN_REPLY_HEADING,
    lede: "Reply is +5.0. Mutual-follow originals add +15.0. Then craft.",
  },
];

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
export const LEARN_REPLY_WEIGHT_HREF = algorithmPermalink(
  "home-mixer/params/param.rs",
  315,
  315,
);
export const LEARN_MUTUAL_REPLY_HREF = algorithmPermalink(
  "home-mixer/params/param.rs",
  316,
  321,
);
export const LEARN_MUTUAL_REPLY_APPLY_HREF = algorithmPermalink(
  "home-mixer/scorers/ranking_scorer.rs",
  180,
  193,
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
