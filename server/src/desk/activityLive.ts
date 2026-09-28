import {
  LIVE_METRICS_ID_CAP,
  activityWindowStartIso,
  applyLiveOwnPostViews,
  bucketClassifiedPosts,
  chartRefreshReplyIds,
  mergeClassifiedActivity,
  mergeLiveMetrics,
  type ActivityBucket,
  type ActivityStatsResult,
} from "./activityStats.js";
import type { Interaction } from "./interactionStore.js";
import { listActivityOwnPosts } from "./ownPostStore.js";
import {
  LIVE_METRICS_WAIT_BUDGET_MS,
  fetchTweetMetricsMany,
} from "../x-api/tweetLookup.js";

export async function bucketInteractionsWithLive(
  history: readonly Interaction[],
  bucket: ActivityBucket,
  userId?: string,
  opts: { signal?: AbortSignal; waitMs?: number } = {},
): Promise<ActivityStatsResult> {
  const ownPosts = userId
    ? listActivityOwnPosts({ userId, sinceIso: activityWindowStartIso() })
    : [];
  const refreshIds = chartRefreshReplyIds(
    history,
    ownPosts,
    LIVE_METRICS_ID_CAP,
  );
  let rows = history;
  let posts = ownPosts;
  if (refreshIds.length) {
    const live = await fetchTweetMetricsMany({
      tweetIds: refreshIds,
      signal: opts.signal,
      waitMs: opts.waitMs ?? LIVE_METRICS_WAIT_BUDGET_MS,
    });
    rows = mergeLiveMetrics(history, live);
    posts = applyLiveOwnPostViews(ownPosts, live);
  }
  return bucketClassifiedPosts(
    mergeClassifiedActivity({ ownPosts: posts, history: rows }),
    { bucket },
  );
}
