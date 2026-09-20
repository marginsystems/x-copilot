import {
  LIVE_METRICS_ID_CAP,
  activityWindowStartIso,
  bucketClassifiedPosts,
  mergeClassifiedActivity,
  mergeLiveMetrics,
  pendingReplyIds,
  type ActivityBucket,
  type ActivityStatsResult,
} from "./activityStats.js";
import type { Interaction } from "./interactionStore.js";
import { listActivityOwnPosts } from "./ownPostStore.js";
import { fetchTweetMetricsMany } from "../x-api/tweetLookup.js";

export async function bucketInteractionsWithLive(
  history: readonly Interaction[],
  bucket: ActivityBucket,
  userId?: string,
): Promise<ActivityStatsResult> {
  const pending = pendingReplyIds(history, LIVE_METRICS_ID_CAP);
  let rows = history;
  if (pending.length) {
    const live = await fetchTweetMetricsMany({ tweetIds: pending });
    rows = mergeLiveMetrics(history, live);
  }
  const ownPosts = userId
    ? listActivityOwnPosts({ userId, sinceIso: activityWindowStartIso() })
    : [];
  return bucketClassifiedPosts(mergeClassifiedActivity({ ownPosts, history: rows }), {
    bucket,
  });
}
