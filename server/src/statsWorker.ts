/**
 * PM2 worker — hourly due-queue for 1h / 24h reply engagement snapshots.
 */
import { resolve } from "node:path";
import { runExpirePass } from "./expirePass.js";
import {
  DEFAULT_STATS_TICK_CAP,
  listDueStatSamples,
  listMemorySyncRetries,
  patchInteractionStats,
  setMemorySyncFailed,
  type DueStatSample,
  type Interaction,
} from "./interactionStore.js";
import { loadEnv } from "./loadEnv.js";
import {
  syncInteractionOutcomeMemory,
  type SyncInteractionOutcomeResult,
} from "./memoryOutcome.js";
import { fetchTweetMetrics } from "./tweetLookup.js";
import { getSessionFromEnv } from "./xSession.js";

const TICK_MS = 60 * 60 * 1000;
const LOOKUP_DELAY_MS = 400;
const MAX_CONSECUTIVE_FAILURES = 3;
const tweetFailures = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run one outcome projection and record its result on the interaction so a
 * failed sync is retried on a later tick instead of being dropped permanently.
 */
async function runOutcomeSync(
  interaction: Interaction,
  checkpoint: DueStatSample["checkpoint"],
  storePath: string | undefined,
  syncOutcome: SyncOutcomeFn,
): Promise<boolean> {
  try {
    const sync = await syncOutcome({ interaction, checkpoint });
    if (sync.ok) {
      await setMemorySyncFailed({
        threadId: interaction.threadId,
        failed: false,
        storePath,
      });
      return true;
    }
    await setMemorySyncFailed({
      threadId: interaction.threadId,
      failed: true,
      storePath,
    });
    console.warn(
      `[stats-worker] memory sync soft-fail threadId=${interaction.threadId}: ${sync.error}`,
    );
    return false;
  } catch (err) {
    await setMemorySyncFailed({
      threadId: interaction.threadId,
      failed: true,
      storePath,
    });
    console.warn(
      `[stats-worker] memory sync soft-fail threadId=${interaction.threadId}:`,
      err,
    );
    return false;
  }
}

export type StatsTickResult = {
  due: number;
  sampled: number;
  failed: number;
  /** Soft-fail memory sync attempts after a successful JSON patch. */
  memorySynced?: number;
  memorySyncFailed?: number;
};

export type SyncOutcomeFn = (opts: {
  interaction: Interaction;
  checkpoint: DueStatSample["checkpoint"];
}) => Promise<SyncInteractionOutcomeResult>;

export async function runStatsTick(opts?: {
  nowMs?: number;
  limit?: number;
  delayMs?: number;
  storePath?: string;
  fetchMetrics?: typeof fetchTweetMetrics;
  /** Injectable outcome sync (tests). Default: Markdown + MiniLM upsert. */
  syncOutcome?: SyncOutcomeFn | null;
}): Promise<StatsTickResult> {
  const fetchMetrics = opts?.fetchMetrics ?? fetchTweetMetrics;
  const delayMs = opts?.delayMs ?? LOOKUP_DELAY_MS;
  const syncOutcome: SyncOutcomeFn | null =
    opts?.syncOutcome === undefined
      ? (args) =>
          syncInteractionOutcomeMemory({
            interaction: args.interaction,
            checkpoint: args.checkpoint,
          })
      : opts.syncOutcome;
  const due = await listDueStatSamples({
    nowMs: opts?.nowMs,
    storePath: opts?.storePath,
    limit: opts?.limit ?? DEFAULT_STATS_TICK_CAP,
  });

  let sampled = 0;
  let failed = 0;
  let memorySynced = 0;
  let memorySyncFailed = 0;
  const session = getSessionFromEnv();

  // Retry outcome projections that failed on a previous tick. Sampled before
  // the due loop so a fresh failure below waits for the next tick, and so the
  // 24h-final checkpoint (never due again) is not permanently lost.
  if (syncOutcome) {
    const retries = await listMemorySyncRetries({
      storePath: opts?.storePath,
      limit: opts?.limit ?? DEFAULT_STATS_TICK_CAP,
    });
    for (const interaction of retries) {
      if (
        await runOutcomeSync(
          interaction,
          interaction.stats?.t24h ? "t24h" : "t1h",
          opts?.storePath,
          syncOutcome,
        )
      ) {
        memorySynced += 1;
      } else {
        memorySyncFailed += 1;
      }
    }
  }

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
    const patched = await patchInteractionStats({
      threadId: item.threadId,
      checkpoint: item.checkpoint,
      snapshot: {
        ...metrics,
        sampledAt: new Date(opts?.nowMs ?? Date.now()).toISOString(),
      },
      storePath: opts?.storePath,
    });
    sampled += 1;

    if (patched && syncOutcome) {
      if (
        await runOutcomeSync(
          patched,
          item.checkpoint,
          opts?.storePath,
          syncOutcome,
        )
      ) {
        memorySynced += 1;
      } else {
        memorySyncFailed += 1;
      }
    }
  }

  // Prune failure entries no longer due to prevent unbounded growth.
  const dueKeys = new Set(due.map((d) => `${d.replyId}:${d.checkpoint}`));
  for (const key of tweetFailures.keys()) {
    if (!dueKeys.has(key)) tweetFailures.delete(key);
  }

  return {
    due: due.length,
    sampled,
    failed,
    memorySynced,
    memorySyncFailed,
  };
}

async function main(): Promise<void> {
  if (!loadEnv(resolve(process.cwd(), ".env"))) {
    console.error("[stats-worker] .env not found — X_AUTH_TOKEN / X_CT0 required");
    process.exit(1);
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
    try {
      const expired = await runExpirePass();
      console.log(`[stats-worker] expire expired=${expired.expired}`);
    } catch (err) {
      console.error("[stats-worker] expire failed:", err);
    }
  };

  await tick();
  setInterval(() => {
    void tick();
  }, TICK_MS);
}

/**
 * Whether this process should start the hourly tick loop.
 * Direct `node …/statsWorker.js` works via argv; PM2 wraps the script in
 * ProcessContainerFork.js and sets `pm_id` — the old endsWith check missed that.
 */
export function shouldRunStatsMain(
  argv1: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (
    argv1?.endsWith("statsWorker.js") ||
    argv1?.endsWith("statsWorker.ts")
  ) {
    return true;
  }
  if (env.pm_id != null && argv1?.includes("ProcessContainerFork")) {
    return true;
  }
  return false;
}

if (shouldRunStatsMain(process.argv[1], process.env)) {
  void main();
}
