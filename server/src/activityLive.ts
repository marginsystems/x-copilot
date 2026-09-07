import {
  LIVE_METRICS_ID_CAP,
  bucketInteractions,
  mergeLiveMetrics,
  pendingReplyIds,
  type ActivityBucket,
  type ActivityStatsResult,
} from "./activityStats.js";
import type { Interaction } from "./interactionStore.js";
import { fetchTweetMetricsMany } from "./tweetLookup.js";

export async function bucketInteractionsWithLive(
  history: readonly Interaction[],
  bucket: ActivityBucket,
): Promise<ActivityStatsResult> {
  const pending = pendingReplyIds(history, LIVE_METRICS_ID_CAP);
  let rows = history;
  if (pending.length) {
    const live = await fetchTweetMetricsMany({ tweetIds: pending });
    rows = mergeLiveMetrics(history, live);
  }
  return bucketInteractions(rows, { bucket });
}
