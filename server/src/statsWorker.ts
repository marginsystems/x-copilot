/**
 * PM2 worker — hourly due-queue for 1h / 24h reply engagement snapshots.
 */
import { resolve } from "node:path";
import { runExpirePass } from "./expirePass.js";
import {
  recordMarkGamification,
  recordT24hBonusGamification,
} from "./gamification.js";
import {
  DEFAULT_STATS_TICK_CAP,
  MAX_INTERACTION_STORE,
  listDueStatSamples,
  listGamificationSyncRetries,
  listMemorySyncRetries,
  patchInteractionStats,
  setGamificationSyncFailed,
  setMemorySyncFailed,
  type DueStatSample,
  type Interaction,
} from "./interactionStore.js";
import { loadEnv } from "./loadEnv.js";
import {
  syncInteractionOutcomeMemory,
  type SyncInteractionOutcomeResult,
} from "./memoryOutcome.js";
import {
  discoverOwnReplies,
  type DiscoverRepliesResult,
} from "./replyDiscover.js";
import { fetchTweetMetrics } from "./tweetLookup.js";
import { getSessionFromEnv } from "./xSession.js";
import {
  listDueOwnPostSamples,
  patchOwnPostSnapshot,
  pruneActivityEvents,
  type DueOwnPostSample,
} from "./ownPostStore.js";
import { resumeDueSubscriptions } from "./xActivitySubscribe.js";
import { runWithRequestContext } from "./requestContext.js";
import { getUserById } from "./authStore.js";
import { creditsExhaustedResponse } from "./billingStore.js";

const TICK_MS = 60 * 60 * 1000;
const LOOKUP_DELAY_MS = 400;
const MAX_CONSECUTIVE_FAILURES = 3;
const ACTIVITY_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const tweetFailures = new Map<string, number>();
const ownPostFailures = new Map<string, number>();

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
  /** Off-app replies upserted this tick (when discovery is enabled). */
  discovered?: number;
  discoverSkipped?: number;
};

export type DiscoverRepliesFn = () => Promise<DiscoverRepliesResult>;

export type SyncOutcomeFn = (opts: {
  interaction: Interaction;
  checkpoint: DueStatSample["checkpoint"];
}) => Promise<SyncInteractionOutcomeResult>;

export async function runStatsTick(opts?: {
  nowMs?: number;
  limit?: number;
  delayMs?: number;
  storePath?: string;
  gamificationPath?: string;
  fetchMetrics?: typeof fetchTweetMetrics;
  /** Injectable outcome sync (tests). Default: Markdown + MiniLM upsert. */
  syncOutcome?: SyncOutcomeFn | null;
  /**
   * Off-app reply discovery (one search/tick). Default off for unit tests;
   * production `main` passes `discoverOwnReplies`.
   */
  discoverReplies?: DiscoverRepliesFn | null;
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
  const discoverReplies = opts?.discoverReplies ?? null;

  let discovered = 0;
  let discoverSkipped = 0;
  if (discoverReplies) {
    try {
      const discovery = await discoverReplies();
      discovered = discovery.discovered;
      discoverSkipped = discovery.skipped;
      if (!discovery.ok) {
        console.warn(
          `[stats-worker] reply discover soft-fail: ${discovery.error ?? "unknown"}`,
        );
      } else if (discovered > 0 || discovery.searched > 0) {
        console.log(
          `[stats-worker] discover searched=${discovery.searched} discovered=${discovered} skipped=${discoverSkipped} own_posts=${discovery.ownPostsIngested ?? 0}`,
        );
      }
    } catch (err) {
      console.warn("[stats-worker] reply discover soft-fail:", err);
    }
  }

  const tickCap = opts?.limit ?? DEFAULT_STATS_TICK_CAP;
  // Oversample the due queue so permanently-failing (burned) oldest rows do
  // not consume the whole tick budget and starve newer replies.
  const allDue = await listDueStatSamples({
    nowMs: opts?.nowMs,
    storePath: opts?.storePath,
    limit: Math.max(tickCap * 20, MAX_INTERACTION_STORE),
  });

  // Prune failure entries no longer due to prevent unbounded growth.
  // Use the full due set (not the tick slice) so burned keys stay remembered.
  const allDueKeys = new Set(
    allDue.map((d) => `${d.replyId}:${d.checkpoint}`),
  );
  for (const key of tweetFailures.keys()) {
    if (!allDueKeys.has(key)) tweetFailures.delete(key);
  }

  const due: DueStatSample[] = [];
  for (const item of allDue) {
    const failKey = `${item.replyId}:${item.checkpoint}`;
    if ((tweetFailures.get(failKey) ?? 0) >= MAX_CONSECUTIVE_FAILURES) {
      continue;
    }
    due.push(item);
    if (due.length >= tickCap) break;
  }

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
      limit: tickCap,
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

  // Retry soft-failed gamification projections (mark XP/streak or t24h bonus)
  // so the durable ledger converges with interactions.json. Both projections
  // are idempotent per (threadId, at), so re-applying a flagged mark never
  // credits XP/streak more than once.
  const gamificationRetries = await listGamificationSyncRetries({
    storePath: opts?.storePath,
    limit: tickCap,
  });
  for (const interaction of gamificationRetries) {
    if (interaction.source === "discovered") continue;
    if (interaction.markGamificationSyncFailed) {
      try {
        // Replay every mark instance that actually failed: a re-mark of the
        // same thread overwrites `at`, so fall back to the persisted pending
        // ats (the current `at` only when none were recorded).
        const pendingAts =
          interaction.pendingMarkAts && interaction.pendingMarkAts.length
            ? interaction.pendingMarkAts
            : [interaction.at];
        for (const pendingAt of pendingAts) {
          const markMs = Date.parse(pendingAt);
          if (!Number.isFinite(markMs)) continue;
          await recordMarkGamification({
            threadId: interaction.threadId,
            interactionStorePath: opts?.storePath,
            gamificationPath: opts?.gamificationPath,
            nowMs: markMs,
          });
        }
        await setGamificationSyncFailed({
          threadId: interaction.threadId,
          checkpoint: "mark",
          failed: false,
          storePath: opts?.storePath,
          clearedPendingAts: pendingAts,
        });
      } catch (err) {
        console.warn(
          `[stats-worker] gamification mark retry soft-fail threadId=${interaction.threadId}:`,
          err,
        );
      }
    }
    const t24h = interaction.stats?.t24h;
    if (interaction.bonusGamificationSyncFailed && t24h) {
      try {
        await recordT24hBonusGamification({
          threadId: interaction.threadId,
          snapshot: t24h,
          interactionStorePath: opts?.storePath,
          gamificationPath: opts?.gamificationPath,
          nowMs: opts?.nowMs,
        });
        await setGamificationSyncFailed({
          threadId: interaction.threadId,
          checkpoint: "t24h",
          failed: false,
          storePath: opts?.storePath,
        });
      } catch (err) {
        console.warn(
          `[stats-worker] gamification t24h bonus retry soft-fail threadId=${interaction.threadId}:`,
          err,
        );
      }
    }
  }

  for (let i = 0; i < due.length; i++) {
    const item: DueStatSample = due[i];
    const tweetId = item.replyId;
    const failKey = `${tweetId}:${item.checkpoint}`;
    const prevFailures = tweetFailures.get(failKey) ?? 0;
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

    // First t24h sample awards scaled engagement XP (idempotent per threadId).
    if (patched && item.checkpoint === "t24h" && patched.source !== "discovered") {
      try {
        await recordT24hBonusGamification({
          threadId: item.threadId,
          snapshot: metrics,
          interactionStorePath: opts?.storePath,
          nowMs: opts?.nowMs,
          gamificationPath: opts?.gamificationPath,
        });
        await setGamificationSyncFailed({
          threadId: item.threadId,
          checkpoint: "t24h",
          failed: false,
          storePath: opts?.storePath,
        });
      } catch (err) {
        console.warn(
          `[stats-worker] gamification t24h bonus soft-fail threadId=${item.threadId}:`,
          err,
        );
        await setGamificationSyncFailed({
          threadId: item.threadId,
          checkpoint: "t24h",
          failed: true,
          storePath: opts?.storePath,
        }).catch(() => {});
      }
    }

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

  return {
    due: due.length,
    sampled,
    failed,
    memorySynced,
    memorySyncFailed,
    discovered,
    discoverSkipped,
  };
}

async function main(): Promise<void> {
  if (
    !loadEnv(resolve(process.cwd(), ".env"), {
      override: true,
      protected: ["NODE_ENV", "PORT"],
    })
  ) {
    console.error(
      "[stats-worker] .env not found — X_API_BEARER_TOKEN required",
    );
    process.exit(1);
  }
  console.log("[stats-worker] started — tick every 1h");

  const tick = async () => {
    try {
      const result = await runStatsTick({
        discoverReplies: () => discoverOwnReplies(),
      });
      console.log(
        `[stats-worker] tick due=${result.due} sampled=${result.sampled} failed=${result.failed} discovered=${result.discovered ?? 0}`,
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
    try {
      const resumed = await resumeDueSubscriptions();
      if (resumed) console.log(`[stats-worker] xaa resumed=${resumed}`);
    } catch (err) {
      console.warn("[stats-worker] xaa resume", err);
    }
    try {
      pruneActivityEvents(
        new Date(Date.now() - ACTIVITY_EVENT_RETENTION_MS).toISOString(),
      );
      // Oversample the due queue so permanently-failing (burned) oldest rows
      // do not consume the whole 15-slot budget and starve healthy posts,
      // mirroring the interaction due loop in runStatsTick above.
      const allDueOwn = listDueOwnPostSamples({ limit: 15 * 20 });
      const dueOwnKeys = new Set(
        allDueOwn.map((d) => `${d.postId}:${d.checkpoint}`),
      );
      for (const key of ownPostFailures.keys()) {
        if (!dueOwnKeys.has(key)) ownPostFailures.delete(key);
      }
      const dueOwn: DueOwnPostSample[] = [];
      for (const item of allDueOwn) {
        const failKey = `${item.postId}:${item.checkpoint}`;
        if ((ownPostFailures.get(failKey) ?? 0) >= MAX_CONSECUTIVE_FAILURES) {
          continue;
        }
        dueOwn.push(item);
        if (dueOwn.length >= 15) break;
      }
      let sampledOwn = 0;
      for (const item of dueOwn) {
        const failKey = `${item.postId}:${item.checkpoint}`;
        const user = getUserById(item.userId);
        if (
          creditsExhaustedResponse({
            userId: item.userId,
            tenantId: item.tenantId,
            email: user?.email ?? null,
          })
        ) {
          continue;
        }
        const metrics = await runWithRequestContext(
          { tenantId: item.tenantId, userId: item.userId },
          () =>
            fetchTweetMetrics({
              tweetId: item.postId,
            }),
        );
        if (!metrics) {
          ownPostFailures.set(failKey, (ownPostFailures.get(failKey) ?? 0) + 1);
          continue;
        }
        ownPostFailures.delete(failKey);
        patchOwnPostSnapshot(item.postId, item.checkpoint, metrics);
        sampledOwn += 1;
        await sleep(LOOKUP_DELAY_MS);
      }
      if (dueOwn.length) {
        console.log(
          `[stats-worker] own-posts due=${dueOwn.length} sampled=${sampledOwn}`,
        );
      }
    } catch (err) {
      console.warn("[stats-worker] own-post snapshots", err);
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
