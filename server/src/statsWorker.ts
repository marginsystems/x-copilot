/**
 * PM2 worker — hourly due-queue for 1h / 24h reply engagement snapshots.
 */
import { resolve } from "node:path";
import {
  DEFAULT_STATS_TICK_CAP,
  listDueStatSamples,
  patchInteractionStats,
  type DueStatSample,
} from "./interactionStore.js";
import { loadEnv } from "./loadEnv.js";
import { fetchTweetMetrics } from "./tweetLookup.js";
import { getSessionFromEnv } from "./xSession.js";

const TICK_MS = 60 * 60 * 1000;
const LOOKUP_DELAY_MS = 400;
const MAX_CONSECUTIVE_FAILURES = 3;
const tweetFailures = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type StatsTickResult = {
  due: number;
  sampled: number;
  failed: number;
};

export async function runStatsTick(opts?: {
  nowMs?: number;
  limit?: number;
  delayMs?: number;
  storePath?: string;
  fetchMetrics?: typeof fetchTweetMetrics;
}): Promise<StatsTickResult> {
  const fetchMetrics = opts?.fetchMetrics ?? fetchTweetMetrics;
  const delayMs = opts?.delayMs ?? LOOKUP_DELAY_MS;
  const due = await listDueStatSamples({
    nowMs: opts?.nowMs,
    storePath: opts?.storePath,
    limit: opts?.limit ?? DEFAULT_STATS_TICK_CAP,
  });

  let sampled = 0;
  let failed = 0;
  const session = getSessionFromEnv();

  for (let i = 0; i < due.length; i++) {
    const item: DueStatSample = due[i];
    const tweetId = item.replyId;
    const failKey = `${tweetId}:${item.checkpoint}`;
    const prevFailures = tweetFailures.get(failKey) ?? 0;
    if (prevFailures >= MAX_CONSECUTIVE_FAILURES) {
      failed += 1;
      continue;
    }
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    const metrics = await fetchMetrics({ tweetId, session });
    if (!metrics) {
      tweetFailures.set(failKey, prevFailures + 1);
      failed += 1;
      continue;
    }
    tweetFailures.delete(failKey);
    await patchInteractionStats({
      threadId: item.threadId,
      checkpoint: item.checkpoint,
      snapshot: {
        ...metrics,
        sampledAt: new Date(opts?.nowMs ?? Date.now()).toISOString(),
      },
      storePath: opts?.storePath,
    });
    sampled += 1;
  }

  // Prune failure entries no longer due to prevent unbounded growth.
  const dueKeys = new Set(due.map((d) => `${d.replyId}:${d.checkpoint}`));
  for (const key of tweetFailures.keys()) {
    if (!dueKeys.has(key)) tweetFailures.delete(key);
  }

  return { due: due.length, sampled, failed };
}

async function main(): Promise<void> {
  if (!loadEnv(resolve(process.cwd(), ".env"))) {
    console.warn("[stats-worker] .env not found — X_AUTH_TOKEN / X_CT0 may be missing");
  }
  console.log("[stats-worker] started — tick every 1h");

  const tick = async () => {
    try {
      const result = await runStatsTick();
      console.log(
        `[stats-worker] tick due=${result.due} sampled=${result.sampled} failed=${result.failed}`,
      );
    } catch (err) {
      console.error("[stats-worker] tick failed:", err);
    }
  };

  await tick();
  setInterval(() => {
    void tick();
  }, TICK_MS);
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("statsWorker.ts") ||
    process.argv[1].endsWith("statsWorker.js"));

if (isMain) {
  void main();
}
