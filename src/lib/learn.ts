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

export const LEARN_DIVERSITY_SNIPPET = `fn diversity_multiplier(decay_factor: f64, floor: f64, exponent: f64) -> f64 {
    (1.0 - floor) * decay_factor.powf(exponent) + floor
}`;

export const LEARN_THUNDER_CAP_SNIPPET = `pub const MAX_POSTS_TO_RETURN: usize = 1200;
pub const MAX_VIDEOS_TO_RETURN: usize = 600;
pub const MAX_INPUT_LIST_SIZE: usize = 10000;

pub const MAX_REPLY_POSTS_PER_AUTHOR: usize = 30;
pub const MAX_ORIGINAL_POSTS_PER_AUTHOR: usize = 50;`;

export const LEARN_BDSM_REPLY_HEAD_SNIPPET = `    Head(
        "ReplySpamBot",
        3,
        8_922,
        (
            "REPLY_SPAM_NO_CONSUMPTION",
            "REPLY_SPAM_BOT",
            "CONVERSATION_SPAMMER",
        ),
    ),`;

export const LEARN_BDSM_TWEET_HEAD_SNIPPET = `    Head(
        "TweetSpamBot",
        4,
        23_425,
        (
            "TWEET_CREATE_BURST",
            "QUOTE_TWEET_SPAMMER",
            "CONTENT_AMPLIFIER",
        ),
    ),`;

export const LEARN_BDSM_FOLLOW_HEAD_SNIPPET = `    Head(
        "FollowBot",
        0,
        27_576,
        (
            "FOLLOW_UNFOLLOW_CYCLE",
            "PURE_FOLLOW_API_BURST",
            "API_ONLY_BOT",
            "GROWTH_SERVICE_BOT",
            "FOLLOW_FARM_BOT",
        ),
    ),`;

export const LEARN_BDSM_LIKE_HEAD_SNIPPET = `    Head(
        "LikeBot",
        1,
        60_320,
        (
            "PURE_LIKE_API_BURST",
            "LIKE_UNLIKE_CYCLE",
            "STEADY_LIKE_DRIP",
            "LIKE_FARM_BOT",
        ),
    ),`;

export const LEARN_BDSM_AMPLIFIER_HEAD_SNIPPET = `    Head(
        "EngagementAmplifier",
        2,
        5_496,
        (
            "LIKE_RETWEET_PAIR",
            "FOLLOW_THEN_FAV_PIPELINE",
            "FOLLOW_THEN_REPLY_PIPELINE",
            "REPLY_THEN_FOLLOW_PIPELINE",
            "ENGAGEMENT_AMPLIFIER",
            "FOLLOW_LIKE_AMPLIFIER",
            "OUTREACH_PIPELINE_BOT",
        ),
    ),`;

export const LEARN_THUNDER_FOLLOW_TAKE_SNIPPET = `        let following_count = following_user_ids.len();
        if following_count > MAX_INPUT_LIST_SIZE {
            warn!(
                "Limiting following_user_ids from {} to {} entries for user {}",
                following_count, MAX_INPUT_LIST_SIZE, req.user_id
            );
        }
        let following_user_ids: Vec<u64> = following_user_ids
            .into_iter()
            .take(MAX_INPUT_LIST_SIZE)
            .collect();`;

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

export const LEARN_VOLUME_TITLE = "How many replies a day — x-copilot";
export const LEARN_VOLUME_HEADING = "How many replies a day";
export const LEARN_VOLUME_DESCRIPTION =
  "X For You has no daily reply or post quota in this snapshot. Decay 0.5 and floor 0.25 multiply extras in one viewer's slate. Thunder takes at most 30 replies per author into that viewer's in-network pool. ReplySpamBot and TweetSpamBot score action sequences; fire thresholds are redacted. A quiet reply adds ~0; it does not subtract. Defaults from xai-org/x-algorithm at d011592. Not affiliated with X Corp.";
export const LEARN_VOLUME_META = `Cited from xai-org/x-algorithm at d011592 (${LEARN_SOURCE_DATE_LABEL}). Defaults in this snapshot. Not affiliated with X Corp.`;
export const LEARN_VOLUME_PATH = "/learn/how-many-replies";

export const LEARN_GIVE_TITLE = "Likes and follows you give — x-copilot";
export const LEARN_GIVE_HEADING = "Likes and follows you give";
export const LEARN_GIVE_DESCRIPTION =
  "When you reply, do not like the parent and do not auto-follow them. LikeBot, FollowBot, and EngagementAmplifier score those sequences; fire thresholds are redacted, so we do not treat that habit as safe. A like you give is not subtracted from your post score. Favorite 0.5 and Follow author 4.0 multiply P(action) for this viewer. Thunder takes at most 10000 followed ids for your in-network fetch. Defaults from xai-org/x-algorithm at d011592. Not affiliated with X Corp.";
export const LEARN_GIVE_META = `Cited from xai-org/x-algorithm at d011592 (${LEARN_SOURCE_DATE_LABEL}). Defaults in this snapshot. Not affiliated with X Corp.`;
export const LEARN_GIVE_PATH = "/learn/likes-and-follows-you-give";
export const LEARN_GIVE_IMAGE = "/og-learn-give.png";
export const LEARN_GIVE_IMAGE_ALT =
  "x-copilot Learn — a like mark enters their post, not your score";
export const LEARN_GIVE_FIGURE_LIKEBOT = "/learn/give-likebot.png";
export const LEARN_GIVE_FIGURE_FOLLOW = "/learn/give-follow-cap.png";

export const LEARN_IMAGE = "/og-learn.png";
export const LEARN_IMAGE_ALT =
  "x-copilot Learn — ranking weights on a dark field";

export type LearnLessonView =
  | "learnWeights"
  | "learnReply"
  | "learnVolume"
  | "learnGive";

export type LearnLesson = {
  view: LearnLessonView;
  href: string;
  number: string;
  heading: string;
  lede: string;
};

export type LearnNavView = LearnLessonView | "learnFollow";

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
  {
    view: "learnVolume",
    href: LEARN_VOLUME_PATH,
    number: "03",
    heading: LEARN_VOLUME_HEADING,
    lede: "0.5 and 0.25 are this viewer's slate. Thunder's 30 is a fetch cap. ReplySpamBot scores sequences.",
  },
  {
    view: "learnGive",
    href: LEARN_GIVE_PATH,
    number: "04",
    heading: LEARN_GIVE_HEADING,
    lede: "Eight spam heads, not For You. Reply-only is ReplySpamBot. Ramp and decay stay theory.",
  },
];

/** Flywheel labels from bdsm/runtime/heads.py. Infer lines are from the names, not official prose. */
export type LearnBdsmFilter = {
  head: string;
  weight: number;
  label: string;
  infer: string;
  scout: string;
};

export const LEARN_BDSM_FILTERS: readonly LearnBdsmFilter[] = [
  { head: "FollowBot", weight: 27576, label: "FOLLOW_UNFOLLOW_CYCLE", infer: "Follow, then unfollow, as a loop.", scout: "No, if you do not follow" },
  { head: "FollowBot", weight: 27576, label: "PURE_FOLLOW_API_BURST", infer: "Follow storm through the API, not a person tapping.", scout: "No, if you do not follow" },
  { head: "FollowBot", weight: 27576, label: "API_ONLY_BOT", infer: "Server follows with no real client dwell.", scout: "No, if you do not follow" },
  { head: "FollowBot", weight: 27576, label: "GROWTH_SERVICE_BOT", infer: "Third-party growth shop.", scout: "No, if you do not follow" },
  { head: "FollowBot", weight: 27576, label: "FOLLOW_FARM_BOT", infer: "Coordinated follow farm.", scout: "No, if you do not follow" },
  { head: "LikeBot", weight: 60320, label: "PURE_LIKE_API_BURST", infer: "Like storm through the API.", scout: "No, if you do not like" },
  { head: "LikeBot", weight: 60320, label: "LIKE_UNLIKE_CYCLE", infer: "Like, then unlike, as a loop.", scout: "No, if you do not like" },
  { head: "LikeBot", weight: 60320, label: "STEADY_LIKE_DRIP", infer: "Metronome likes, including like-every-parent.", scout: "No, if you do not like" },
  { head: "LikeBot", weight: 60320, label: "LIKE_FARM_BOT", infer: "Coordinated like farm.", scout: "No, if you do not like" },
  { head: "EngagementAmplifier", weight: 5496, label: "LIKE_RETWEET_PAIR", infer: "Like and retweet as a pair.", scout: "No, if you do not like or repost" },
  { head: "EngagementAmplifier", weight: 5496, label: "FOLLOW_THEN_FAV_PIPELINE", infer: "Follow, then like.", scout: "No, if you skip both" },
  { head: "EngagementAmplifier", weight: 5496, label: "FOLLOW_THEN_REPLY_PIPELINE", infer: "Follow, then reply.", scout: "No, if you do not follow" },
  { head: "EngagementAmplifier", weight: 5496, label: "REPLY_THEN_FOLLOW_PIPELINE", infer: "Reply, then follow.", scout: "No, if you do not follow" },
  { head: "EngagementAmplifier", weight: 5496, label: "ENGAGEMENT_AMPLIFIER", infer: "Catch-all outreach loop.", scout: "No, if reply is the only action" },
  { head: "EngagementAmplifier", weight: 5496, label: "FOLLOW_LIKE_AMPLIFIER", infer: "Follow and like as a loop.", scout: "No, if you skip both" },
  { head: "EngagementAmplifier", weight: 5496, label: "OUTREACH_PIPELINE_BOT", infer: "Scripted outreach sequence.", scout: "No, if reply is the only action" },
  { head: "ReplySpamBot", weight: 8922, label: "REPLY_SPAM_NO_CONSUMPTION", infer: "Reply without reading the parent (no dwell / no render).", scout: "Yes" },
  { head: "ReplySpamBot", weight: 8922, label: "REPLY_SPAM_BOT", infer: "Reply stream that looks like spam.", scout: "Yes" },
  { head: "ReplySpamBot", weight: 8922, label: "CONVERSATION_SPAMMER", infer: "Flooding the same thread or conversation.", scout: "Yes" },
  { head: "TweetSpamBot", weight: 23425, label: "TWEET_CREATE_BURST", infer: "Originals posted in a burst.", scout: "Only if you also original" },
  { head: "TweetSpamBot", weight: 23425, label: "QUOTE_TWEET_SPAMMER", infer: "Quote spam.", scout: "Only if you also quote" },
  { head: "TweetSpamBot", weight: 23425, label: "CONTENT_AMPLIFIER", infer: "Pumping the same content.", scout: "Only if you also original or quote" },
  { head: "RTBot", weight: 5290, label: "PURE_RETWEET_API_BURST", infer: "Repost storm through the API.", scout: "No, if you do not repost" },
  { head: "RTBot", weight: 5290, label: "RETWEET_UNRETWEET_CYCLE", infer: "Repost, then undo, as a loop.", scout: "No, if you do not repost" },
  { head: "MultiActionBot", weight: 17474, label: "MULTI_ACTION_ENGAGEMENT_BOT", infer: "More than one action automated.", scout: "Only if the reply stream looks scripted" },
  { head: "MultiActionBot", weight: 17474, label: "SCROLL_AND_LIKE", infer: "Scroll mixed with likes.", scout: "No, if you do not like" },
  { head: "MultiActionBot", weight: 17474, label: "MIXED_AUTOMATION", infer: "Mixed automated actions.", scout: "Only if the reply stream looks scripted" },
  { head: "MultiActionBot", weight: 17474, label: "SCROLL_BOT_NO_ENGAGEMENT", infer: "Scrolling with no real engage.", scout: "No" },
  { head: "MultiActionBot", weight: 17474, label: "MIXED_ENGAGEMENT_AUTOMATION", infer: "Automated mix of engages.", scout: "Only if the reply stream looks scripted" },
  { head: "MultiActionBot", weight: 17474, label: "SYNTHETIC_CONSUMER", infer: "Fake reader account.", scout: "No" },
  { head: "MultiActionBot", weight: 17474, label: "AUTOMATED_ENGAGEMENT_BOT", infer: "Engagement run by a script.", scout: "Only if the reply stream looks scripted" },
  { head: "MultiActionBot", weight: 17474, label: "PASSIVE_SURVEILLANCE_BOT", infer: "Watch without looking human.", scout: "No" },
  { head: "MultiActionBot", weight: 17474, label: "COORDINATED_INAUTHENTIC_BOT", infer: "Several accounts moving together.", scout: "No" },
  { head: "LegitimateUser", weight: 0, label: "LEGITIMATE_ORGANIC_USER", infer: "Looks like a person.", scout: "Counter-class, not a hit" },
  { head: "LegitimateUser", weight: 0, label: "INFREQUENT_LEGITIMATE_USER", infer: "Quiet real account.", scout: "Counter-class, not a hit" },
  { head: "LegitimateUser", weight: 0, label: "POWER_USER_API_CLIENT", infer: "Heavy API use that is still legit.", scout: "Counter-class, not a hit" },
  { head: "LegitimateUser", weight: 0, label: "NEW_ACCOUNT_ONBOARDING", infer: "New account acting like onboarding.", scout: "Counter-class, not a hit" },
  { head: "LegitimateUser", weight: 0, label: "DEVELOPER_TESTING", infer: "Dev / test traffic.", scout: "Counter-class, not a hit" },
  { head: "LegitimateUser", weight: 0, label: "LEGITIMATE_USER", infer: "Generic organic label.", scout: "Counter-class, not a hit" },
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
export const LEARN_DIVERSITY_ENABLE_HREF = algorithmPermalink(
  "home-mixer/params/param.rs",
  222,
  227,
);
export const LEARN_DIVERSITY_FN_HREF = algorithmPermalink(
  "home-mixer/scorers/ranking_scorer.rs",
  643,
  645,
);
export const LEARN_DIVERSITY_APPLY_HREF = algorithmPermalink(
  "home-mixer/scorers/ranking_scorer.rs",
  717,
  740,
);
export const LEARN_README_ADJUST_HREF = algorithmPermalink("README.md", 345, 349);
export const LEARN_THUNDER_CAP_HREF = algorithmPermalink("thunder/config.rs", 1, 6);
export const LEARN_THUNDER_FETCH_HREF = algorithmPermalink(
  "thunder/posts/post_store.rs",
  251,
  365,
);
export const LEARN_BDSM_HEADS_HREF = algorithmPermalink("bdsm/README.md", 30, 34);
export const LEARN_BDSM_ROPE_HREF = algorithmPermalink("bdsm/README.md", 22, 24);
export const LEARN_BDSM_FEATURES_HREF = algorithmPermalink("bdsm/README.md", 26, 29);
export const LEARN_BDSM_SEQ_HREF = algorithmPermalink("bdsm/README.md", 102, 103);
export const LEARN_BDSM_REDACT_HREF = algorithmPermalink("bdsm/README.md", 104, 115);
export const LEARN_BDSM_ACTION_HREF = algorithmPermalink("bdsm/README.md", 63, 66);
export const LEARN_BDSM_REPLY_HEAD_HREF = algorithmPermalink(
  "bdsm/runtime/heads.py",
  54,
  63,
);
export const LEARN_BDSM_TWEET_HEAD_HREF = algorithmPermalink(
  "bdsm/runtime/heads.py",
  64,
  73,
);
export const LEARN_BDSM_FOLLOW_HEAD_HREF = algorithmPermalink(
  "bdsm/runtime/heads.py",
  17,
  28,
);
export const LEARN_BDSM_LIKE_HEAD_HREF = algorithmPermalink(
  "bdsm/runtime/heads.py",
  29,
  39,
);
export const LEARN_BDSM_AMPLIFIER_HEAD_HREF = algorithmPermalink(
  "bdsm/runtime/heads.py",
  40,
  53,
);
export const LEARN_BDSM_MULTI_HEAD_HREF = algorithmPermalink(
  "bdsm/runtime/heads.py",
  83,
  98,
);
export const LEARN_BDSM_SINK_ENFORCE_HREF = algorithmPermalink(
  "bdsm/runtime/sink_policy.yaml",
  16,
  20,
);
export const LEARN_BDSM_SINK_LIVENESS_HREF = algorithmPermalink(
  "bdsm/runtime/sink_policy.yaml",
  26,
  28,
);
export const LEARN_THUNDER_FOLLOW_TAKE_HREF = algorithmPermalink(
  "thunder/thunder_service.rs",
  232,
  242,
);
export const LEARN_PHOENIX_FAV_HREF = algorithmPermalink(
  "phoenix/README.md",
  274,
  275,
);
export const LEARN_BDSM_COOLDOWN_HREF = algorithmPermalink(
  "bdsm/runtime/score_results_sink_focal.py",
  344,
  357,
);
export const LEARN_UTH_HREF = algorithmPermalink("README.md", 438, 442);
export const LEARN_RANKING_VISIBILITY_HREF = algorithmPermalink(
  "README.md",
  464,
  466,
);

/** Defaults at LEARN_DIVERSITY_HREF. k is prior posts from this author in this slate. */
export const LEARN_DIVERSITY_DECAY = 0.5;
export const LEARN_DIVERSITY_FLOOR = 0.25;

export function learnDiversityMultiplier(k: number): number {
  return (1 - LEARN_DIVERSITY_FLOOR) * LEARN_DIVERSITY_DECAY ** k + LEARN_DIVERSITY_FLOOR;
}

export function learnAdjacentLessons(view: string): {
  prev: LearnLesson | null;
  next: LearnLesson | null;
} {
  const index = LEARN_LESSONS.findIndex((lesson) => lesson.view === view);
  if (index < 0) return { prev: null, next: null };
  return {
    prev: LEARN_LESSONS[index - 1] ?? null,
    next: LEARN_LESSONS[index + 1] ?? null,
  };
}

export function formatLearnWeight(weight: number): string {
  const sign = weight > 0 ? "+" : "";
  return `${sign}${weight.toFixed(1)}`;
}

export function weightPermalink(row: LearnWeight): string {
  return algorithmPermalink("home-mixer/params/param.rs", row.startLine, row.endLine);
}
