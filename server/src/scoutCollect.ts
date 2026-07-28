/**
 * Streaming Scout collector — fill a hard-filtered bucket, then LLM-qualify.
 * Discard/refill on zero cool; stop when a bucket yields ≥1 cool lead.
 */
import {
  filterThreadsByCooldown,
  getAuthorKeysForScoutFilter,
  getCooledAuthorKeys,
} from "./interactionStore.js";
import { toOpenCodeTurns, type ScoutStageEvent } from "./opencodeAdapter.js";
import { planQueriesFromAgenda } from "./queryPlan.js";
import { saveScoutCache } from "./scoutCache.js";
import type { ScoutFilters } from "./scoutRun.js";
import {
  filterThreadsByLength,
  resolveMaxThreadCharsFromFilters,
} from "./threadFilters.js";
import { triageThreads } from "./threadTriage.js";
import { hydrateReplyParents } from "./tweetLookup.js";
import {
  searchTimelinePages,
  type ThreadCard,
} from "./xSearch.js";
import { getSessionFromEnv, type SessionCreds } from "./xSession.js";

export type ScoutStopReason =
  | "qualified"
  | "exhausted"
  | "aborted"
  | "target";

export type ScoutCollectStageId =
  | "planning"
  | "searching"
  | "filtering"
  | "triaging"
  | "partial"
  | "done"
  | "error";

export type ScoutCollectEvent = {
  agent: "scout";
  stage: ScoutCollectStageId;
  message: string;
  detail?: unknown;
  at: string;
  threads?: ThreadCard[];
  queries?: string[];
  coolCount?: number;
  targetCool?: number;
  bucketSize?: number;
  candidates?: number;
  stopReason?: ScoutStopReason;
  triageWarning?: string;
  errors?: Array<{ query: string; message: string }>;
  plannedBy?: "client" | "deepseek";
  model?: string;
  opencodeTurns?: ReturnType<typeof toOpenCodeTurns>;
};

export const DEFAULT_TARGET_COOL = 8;
export const DEFAULT_BUCKET_SIZE = 5;
export const COLLECT_COUNT_PER_QUERY = 20;
export const COLLECT_QUERY_DELAY_MS = 500;
export const MAX_SEARCH_CALLS = 24;
export const MAX_BUCKET_ATTEMPTS = 6;
/** Cool = engageable + bait not high. */
export const COOL_MAX_BAIT = 45;

export function clampTargetCool(value: unknown): number {
  if (typeof value !== "number") return DEFAULT_TARGET_COOL;
  if (!Number.isInteger(value)) return DEFAULT_TARGET_COOL;
  if (value < 1) return 1;
  if (value > 20) return 20;
  return value;
}

/** Bucket size is only 5 or 10 (default 5). */
export function clampBucketSize(value: unknown): number {
  if (value === 10 || value === "10") return 10;
  if (value === 5 || value === "5") return 5;
  return DEFAULT_BUCKET_SIZE;
}

export function isCoolThread(thread: ThreadCard): boolean {
  if (thread.engage !== "priority" && thread.engage !== "consider") {
    return false;
  }
  const bait = thread.baitScore ?? thread.score;
  if (typeof bait !== "number" || !Number.isFinite(bait)) return false;
  return bait <= COOL_MAX_BAIT;
}

function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
  });
}

function emit(
  onEvent: ((e: ScoutCollectEvent) => void) | undefined,
  stage: ScoutCollectStageId,
  message: string,
  extra?: Partial<ScoutCollectEvent>,
): ScoutCollectEvent {
  const event: ScoutCollectEvent = {
    agent: "scout",
    stage,
    message,
    at: new Date().toISOString(),
    ...extra,
  };
  onEvent?.(event);
  return event;
}

export type ScoutCollectResult =
  | { ok: true; event: ScoutCollectEvent }
  | { ok: false; status: number; error: string; message: string };

export type ScoutCollectDeps = {
  /** Stub with same result shape as searchTimelinePages. */
  searchTimeline?: typeof searchTimelinePages;
  triageThreads?: typeof triageThreads;
  planQueriesFromAgenda?: typeof planQueriesFromAgenda;
  getCooledAuthorKeys?: typeof getCooledAuthorKeys;
  getAuthorKeysForScoutFilter?: typeof getAuthorKeysForScoutFilter;
  saveScoutCache?: typeof saveScoutCache;
  hydrateReplyParents?: typeof hydrateReplyParents;
  sleep?: typeof sleep;
};

export async function runScoutCollect(opts: {
  agenda?: string;
  queries?: string[];
  filters?: ScoutFilters;
  targetCool?: number;
  bucketSize?: number;
  session?: SessionCreds;
  signal?: AbortSignal;
  onEvent?: (event: ScoutCollectEvent) => void;
  deps?: ScoutCollectDeps;
}): Promise<ScoutCollectResult> {
  const deps = opts.deps ?? {};
  const doSearch = deps.searchTimeline ?? searchTimelinePages;
  const doTriage = deps.triageThreads ?? triageThreads;
  const doPlan = deps.planQueriesFromAgenda ?? planQueriesFromAgenda;
  const doGetCooled = deps.getCooledAuthorKeys ?? getCooledAuthorKeys;
  const doGetFilterKeys =
    deps.getAuthorKeysForScoutFilter ?? getAuthorKeysForScoutFilter;
  const doSaveCache = deps.saveScoutCache ?? saveScoutCache;
  const doHydrate = deps.hydrateReplyParents ?? hydrateReplyParents;
  const doSleep = deps.sleep ?? sleep;

  const session = opts.session ?? getSessionFromEnv();
  if (!session.configured) {
    return {
      ok: false,
      status: 401,
      error: "missing_credentials",
      message: "Set X_AUTH_TOKEN and X_CT0 in .env.",
    };
  }

  const targetCool = clampTargetCool(opts.targetCool);
  const bucketSize = clampBucketSize(opts.bucketSize);
  const events: ScoutStageEvent[] = [];
  const track = (
    stage: ScoutCollectStageId,
    message: string,
    extra?: Partial<ScoutCollectEvent>,
  ) => {
    const ev = emit(opts.onEvent, stage, message, {
      bucketSize,
      targetCool,
      ...extra,
    });
    events.push({
      agent: "scout",
      stage,
      message,
      detail: extra?.detail,
      at: ev.at,
    });
    return ev;
  };

  const aborted = () => Boolean(opts.signal?.aborted);

  let queries = (opts.queries ?? []).map((q) => q.trim()).filter(Boolean);
  let plannedBy: "client" | "deepseek" = "client";
  let planModel: string | undefined;
  const agenda = (opts.agenda ?? "").trim();

  if (queries.length === 0) {
    if (!agenda) {
      return {
        ok: false,
        status: 400,
        error: "missing_agenda",
        message: "Pass { agenda: string } or { queries: string[] }.",
      };
    }
    if (!process.env.DEEPSEEK_API_KEY?.trim()) {
      return {
        ok: false,
        status: 503,
        error: "missing_deepseek_key",
        message: "Set DEEPSEEK_API_KEY for agenda → query planning.",
      };
    }
    track("planning", "Scout is planning search queries…");
    const plan = await doPlan(agenda);
    if (aborted()) {
      const done = track("done", "Scout stopped.", {
        threads: [],
        coolCount: 0,
        stopReason: "aborted",
        queries: [],
      });
      return { ok: true, event: done };
    }
    if (!plan.ok) {
      track("error", `Scout failed: ${plan.message}`);
      return {
        ok: false,
        status: 502,
        error: plan.error,
        message: plan.message,
      };
    }
    queries = plan.queries;
    plannedBy = "deepseek";
    planModel = plan.model;
  } else {
    track("planning", "Scout is using client-provided queries…", {
      detail: { queries },
    });
  }

  const maxChars = resolveMaxThreadCharsFromFilters(
    opts.filters?.maxThreadChars,
    process.env.X_MAX_THREAD_CHARS,
  );
  const dropArticles = opts.filters?.dropArticles !== false;
  // Tests often stub getCooledAuthorKeys only; production uses lifetime+24h filter.
  const cooled =
    deps.getCooledAuthorKeys && !deps.getAuthorKeysForScoutFilter
      ? await doGetCooled()
      : await doGetFilterKeys({
          dedupeAccounts: opts.filters?.dedupeAccounts,
        });

  const cool: ThreadCard[] = [];
  const seenIds = new Set<string>();
  let bucket: ThreadCard[] = [];
  const searchErrors: Array<{ query: string; message: string }> = [];
  let triageWarning: string | undefined;
  let stopReason: ScoutStopReason = "exhausted";
  let searchCalls = 0;
  let queryIndex = 0;
  let replanned = false;
  let bucketAttempts = 0;

  async function maybeReplan(): Promise<boolean> {
    if (replanned || !agenda || !process.env.DEEPSEEK_API_KEY?.trim()) {
      return false;
    }
    replanned = true;
    track("planning", "Scout is planning more search queries…");
    const plan = await doPlan(agenda);
    if (!plan.ok) {
      searchErrors.push({ query: "(replan)", message: plan.message });
      return false;
    }
    queries = plan.queries;
    plannedBy = "deepseek";
    planModel = plan.model;
    queryIndex = 0;
    return queries.length > 0;
  }

  try {
    while (
      !aborted() &&
      cool.length === 0 &&
      bucketAttempts < MAX_BUCKET_ATTEMPTS
    ) {
      // Fill hard-filter bucket (no LLM).
      while (!aborted() && bucket.length < bucketSize) {
        if (searchCalls >= MAX_SEARCH_CALLS) break;

        if (queries.length === 0) {
          const ok = await maybeReplan();
          if (!ok) break;
        }

        if (queryIndex >= queries.length) {
          const ok = await maybeReplan();
          if (ok) {
            // fresh list from replan
          } else if (queries.length > 0) {
            queryIndex = 0; // cycle existing queries
          } else {
            break;
          }
        }

        if (queryIndex >= queries.length) break;

        if (searchCalls > 0) {
          await doSleep(COLLECT_QUERY_DELAY_MS, opts.signal);
        }

        const query = queries[queryIndex];
        queryIndex += 1;
        searchCalls += 1;

        track(
          "searching",
          `Candidates ${bucket.length}/${bucketSize} · searching X…`,
          {
            candidates: bucket.length,
            coolCount: 0,
            detail: {
              query,
              searchCall: searchCalls,
              queryIndex,
              totalQueries: queries.length,
            },
          },
        );

        const result = await doSearch({
          query,
          count: COLLECT_COUNT_PER_QUERY,
          session,
          signal: opts.signal,
        });
        if (aborted()) break;

        if (!result.ok) {
          searchErrors.push({ query, message: result.message });
          continue;
        }

        track(
          "filtering",
          `Candidates ${bucket.length}/${bucketSize} · applying cooldown + length filters…`,
          { candidates: bucket.length, coolCount: 0 },
        );

        const fresh = result.threads.filter((t) => {
          if (!t.id || seenIds.has(t.id)) return false;
          seenIds.add(t.id);
          return true;
        });
        const afterCool = filterThreadsByCooldown(fresh, cooled);
        const afterLen = filterThreadsByLength(afterCool.threads, maxChars, {
          dropArticles,
        });

        for (const t of afterLen.threads) {
          if (bucket.length >= bucketSize) break;
          bucket.push(t);
        }

        track(
          "partial",
          `Candidates ${bucket.length}/${bucketSize}`,
          {
            candidates: bucket.length,
            coolCount: 0,
            detail: {
              raw: result.threads.length,
              afterCooldown: afterCool.threads.length,
              afterLength: afterLen.threads.length,
            },
          },
        );
      }

      if (aborted()) {
        stopReason = "aborted";
        break;
      }

      if (bucket.length < bucketSize) {
        stopReason = "exhausted";
        break;
      }

      bucketAttempts += 1;
      track(
        "triaging",
        `Scout is scoring bucket of ${bucket.length} candidates…`,
        {
          candidates: bucket.length,
          coolCount: 0,
          detail: { bucketAttempt: bucketAttempts },
        },
      );

      // Attach OP text for replies before LLM triage (promo-root skip).
      const forTriage = await doHydrate({
        threads: bucket,
        session,
        signal: opts.signal,
      });
      if (aborted()) {
        stopReason = "aborted";
        break;
      }

      const triaged = await doTriage({ agenda, threads: forTriage });
      if (triaged.warning) triageWarning = triaged.warning;

      const newlyCool = triaged.threads.filter(isCoolThread);
      if (newlyCool.length === 0) {
        track(
          "filtering",
          "0 cool — discarding bucket and refilling…",
          {
            candidates: 0,
            coolCount: 0,
            detail: { bucketAttempt: bucketAttempts },
          },
        );
        bucket = [];
        continue;
      }

      cool.push(...newlyCool);
      stopReason = "qualified";
      track("partial", `Cool ${cool.length} (≥1 from bucket)`, {
        threads: newlyCool,
        coolCount: cool.length,
        candidates: bucketSize,
      });
      break;
    }

    if (aborted()) stopReason = "aborted";
    else if (cool.length >= 1) stopReason = "qualified";
    else stopReason = "exhausted";
  } catch (err) {
    if (isAbortError(err)) {
      stopReason = "aborted";
    } else {
      const message = err instanceof Error ? err.message : String(err);
      track("error", `Scout failed: ${message}`);
      return {
        ok: false,
        status: 500,
        error: "collect_failed",
        message,
      };
    }
  }

  const stopMessage =
    stopReason === "qualified"
      ? `Scout found ${cool.length} cool thread${cool.length === 1 ? "" : "s"} from a qualified bucket.`
      : stopReason === "aborted"
        ? `Scout stopped — ${cool.length} cool threads.`
        : `Scout finished — ${cool.length} cool threads (supply exhausted).`;

  const done = track("done", stopMessage, {
    threads: cool,
    queries,
    coolCount: cool.length,
    targetCool,
    bucketSize,
    candidates: bucket.length,
    stopReason,
    triageWarning,
    errors: searchErrors.length ? searchErrors : undefined,
    plannedBy,
    model: planModel,
    opencodeTurns: toOpenCodeTurns(events),
  });

  try {
    await doSaveCache({
      savedAt: done.at,
      agenda: agenda || undefined,
      queries,
      threads: cool,
      message: done.message,
      triageWarning,
    });
  } catch (err) {
    console.error("Failed to persist last Scout collect:", err);
  }

  return { ok: true, event: done };
}
