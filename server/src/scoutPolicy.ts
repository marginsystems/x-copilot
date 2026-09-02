import type { ThreadCard } from "./threadCard.js";
import { threadHasCoolSkipPromoFlag } from "./threadFilters.js";
import { isCoolSkipThreadKind } from "./threadTriage.js";

export const DEFAULT_TARGET_COOL = 5;
export const DEFAULT_BUCKET_SIZE = 20;
export const COLLECT_COUNT_PER_QUERY = 20;
export const COLLECT_QUERY_DELAY_MS = 500;

/** Avoid billing retweets and reply leaves. Scout aims at original posts. */
export function withScoutSearchExclusions(query: string): string {
  let q = query.trim();
  if (!q) return q;
  q = q.replace(/(?:^|\s)is:reply\b/gi, " ").replace(/\s+/g, " ").trim();
  if (!q) q = "-is:retweet -is:reply";
  if (!/(?:^|\s)-is:retweet\b/i.test(q)) q = `${q} -is:retweet`;
  if (!/(?:^|\s)-is:reply\b/i.test(q)) q = `${q} -is:reply`;
  return q;
}
export const MAX_SEARCH_CALLS = 48;
export const MAX_BUCKET_ATTEMPTS = 8;
/** Cool = engageable + bait not high. */
export const COOL_MAX_BAIT = 45;

export function clampTargetCool(value: unknown): number {
  if (typeof value !== "number") return DEFAULT_TARGET_COOL;
  if (!Number.isInteger(value)) return DEFAULT_TARGET_COOL;
  if (value < 1) return 1;
  if (value > 20) return 20;
  return value;
}

/** Bucket size is 5, 10, or 20 (default 20). */
export function clampBucketSize(value: unknown): number {
  if (value === 20 || value === "20") return 20;
  if (value === 10 || value === "10") return 10;
  if (value === 5 || value === "5") return 5;
  return DEFAULT_BUCKET_SIZE;
}

export function isCoolThread(thread: ThreadCard): boolean {
  if (thread.engage !== "priority" && thread.engage !== "consider") {
    return false;
  }
  if (isCoolSkipThreadKind(thread.threadKind)) {
    return false;
  }
  if (threadHasCoolSkipPromoFlag(thread)) {
    return false;
  }
  const bait = thread.baitScore ?? thread.score;
  if (typeof bait !== "number" || !Number.isFinite(bait)) return false;
  return bait <= COOL_MAX_BAIT;
}
