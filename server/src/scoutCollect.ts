/**
 * Streaming Scout collector — fill a hard-filtered bucket, then LLM-qualify.
 * Discard/refill on zero cool; keep cools and refill until cool target or exhausted.
 */
import {
  filterThreadsByCooldown,
  getAuthorKeysForScoutFilter,
  getCooledAuthorKeys,
  getEverInteractedConversationIds,
  normalizeAuthorKey,
} from "./interactionStore.js";
import { getBlockedConversationIds } from "./dismissalStore.js";
import { toOpenCodeTurns, type ScoutStageEvent } from "./opencodeAdapter.js";
import {
  addTokenUsage,
  deepseekConfigured,
  type LlmProvider,
  type TokenUsage,
} from "./deepseek.js";
import {
  planQueriesFromAgenda,
  type PlanQueriesOpts,
} from "./queryPlan.js";
import { saveScoutCache } from "./scoutCache.js";
import type { ScoutFilters, ScoutPipelineCounts } from "./scoutRun.js";
import {
  filterAutomatedAccounts,
  filterByLanguage,
  filterEmDashes,
  filterOutboundLinks,
  filterSelfReplies,
  filterThreadsByLength,
  normalizePreferredLanguageCode,
  collectBaitConversationIds,
  replyUnderBaitConversation,
  resolveExcludedTags,
  resolveMaxThreadCharsFromFilters,
  threadHasCoolSkipPromoFlag,
  threadHasExcludedTag,
} from "./threadFilters.js";
import { isCoolSkipThreadKind, triageThreads } from "./threadTriage.js";
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
  | "target"
  | "rate_limited"
  | "terminal_error"
  | "credits_exhausted";

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
  linkFiltered?: number;
  linkWarning?: string;
  emDashFiltered?: number;
  emDashWarning?: string;
  automatedFiltered?: number;
  automatedWarning?: string;
  languageFiltered?: number;
  pipelineCounts?: ScoutPipelineCounts;
  errors?: Array<{ query: string; message: string }>;
  plannedBy?: "client" | LlmProvider;
  model?: string;
  llmProvider?: LlmProvider;
  llmUsage?: TokenUsage;
  unhydratedReplyCount?: number;
  opencodeTurns?: ReturnType<typeof toOpenCodeTurns>;
};

export const DEFAULT_TARGET_COOL = 5;
export const DEFAULT_BUCKET_SIZE = 20;
export const COLLECT_COUNT_PER_QUERY = 20;
export const COLLECT_QUERY_DELAY_MS = 500;
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
  getBlockedConversationIds?: typeof getBlockedConversationIds;
  /** @deprecated use getBlockedConversationIds */
  getEverInteractedConversationIds?: typeof getEverInteractedConversationIds;
  saveScoutCache?: typeof saveScoutCache;
  hydrateReplyParents?: typeof hydrateReplyParents;
  sleep?: typeof sleep;
  /**
   * Monthly-credit ceiling: when it returns false the refill loop stops so a
   * single run cannot keep reading past the tenant's remaining pool.
   */
  creditGate?: () => boolean | Promise<boolean>;
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
  const doGetConversationIds =
    deps.getBlockedConversationIds ??
    deps.getEverInteractedConversationIds ??
    getBlockedConversationIds;
  const doSaveCache = deps.saveScoutCache ?? saveScoutCache;
  const doHydrate = deps.hydrateReplyParents ?? hydrateReplyParents;
  const doSleep = deps.sleep ?? sleep;

  const session = opts.session ?? getSessionFromEnv();
  if (!session.bearerToken) {
    return {
      ok: false,
      status: 401,
      error: "missing_credentials",
      message: "Set X_API_BEARER_TOKEN in .env (Pay Per Use app bearer).",
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
  const llmProvider: LlmProvider = "deepseek";
  let plannedBy: "client" | LlmProvider = "client";
  let planModel: string | undefined;
  let llmUsage: TokenUsage | undefined;
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
    if (!deepseekConfigured()) {
      return {
        ok: false,
        status: 503,
        error: "missing_llm_key",
        message: "Set DEEPSEEK_API_KEY for agenda → query planning.",
      };
    }
    track("planning", "Scout is planning search queries (deepseek)…");
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
    plannedBy = llmProvider;
    planModel = plan.model;
    llmUsage = addTokenUsage(llmUsage, plan.usage);
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
  const dropEmDashes = opts.filters?.dropEmDashes !== false;
  const dropAutomatedAccounts = opts.filters?.dropAutomatedAccounts !== false;
  const preferredLanguage = normalizePreferredLanguageCode(
    opts.filters?.preferredLanguage,
  );
  const excludedTags = resolveExcludedTags(opts.filters?.excludedTags);
  // Tests often stub getCooledAuthorKeys only; production uses lifetime+24h filter.
  const cooled =
    deps.getCooledAuthorKeys && !deps.getAuthorKeysForScoutFilter
      ? await doGetCooled()
      : await doGetFilterKeys({
          dedupeAccounts: opts.filters?.dedupeAccounts,
        });
  // Suppress conversations we've Marked or Not interested (OP + sibling replies).
  // Tests that stub only getCooledAuthorKeys stay isolated from the durable store.
  const blockedConversations =
    deps.getCooledAuthorKeys &&
    !deps.getAuthorKeysForScoutFilter &&
    !deps.getBlockedConversationIds &&
    !deps.getEverInteractedConversationIds
      ? new Set<string>()
      : await doGetConversationIds();

  let cool: ThreadCard[] = [];
  const seenIds = new Set<string>();
  /** Per-run author dedupe (first kept wins across bucket refills). */
  const seenAuthors = new Set<string>();
  const coolAuthors = new Set<string>();
  /** Bait roots/parents seen this Scout run — suppress sibling replies. */
  const baitConversationIds = new Set<string>();
  let bucket: ThreadCard[] = [];
  const searchErrors: Array<{ query: string; message: string }> = [];
  let triageWarning: string | undefined;
  let stopReason: ScoutStopReason = "exhausted";
  let rateLimited = false;
  let creditStopped = false;
  let terminalError: string | undefined;
  let unhydratedReplyCount = 0;
  let searchCalls = 0;
  let queryIndex = 0;
  let replanned = false;
  let bucketAttempts = 0;
  let consecutiveZeroAdds = 0;
  let linkFilteredTotal = 0;
  let emDashFilteredTotal = 0;
  let automatedFilteredTotal = 0;
  let languageFilteredTotal = 0;
  // Collect funnel is per-search cumulative: the filter stages (raw → afterLength)
  // sum every search page across all buckets/refills, while afterTriage sums only
  // the threads actually scored (bucket-qualified). The afterLength → afterTriage
  // gap is the bucket-qualification drop (author dedupe / bucket-full / partial
  // stop), not a triage drop — unlike runScoutSearch's single-pass funnel.
  const funnelCounts: ScoutPipelineCounts = {
    raw: 0,
    afterDedupe: 0,
    afterCooldown: 0,
    afterSelfReply: 0,
    afterLinks: 0,
    afterLength: 0,
    afterHydrateSelfReply: 0,
    afterTriage: 0,
  };

  async function maybeReplan(reason: "cycle" | "stalled"): Promise<boolean> {
    if (replanned || !agenda || !deepseekConfigured()) {
      return false;
    }
    replanned = true;
    track(
      "planning",
      reason === "stalled"
        ? "Scout is broadening search queries (low yield)…"
        : "Scout is broadening search queries…",
    );
    const planOpts: PlanQueriesOpts = {
      broaden: true,
      priorQueries: [...queries],
      yieldNote:
        `Low yield: candidate bucket at ${bucket.length}/${bucketSize} after ${searchCalls} searches` +
        (reason === "stalled"
          ? ` (${consecutiveZeroAdds} consecutive searches added 0).`
          : ".") +
        " Stuck under candidate bucket — broaden; prefer shorter high-recall 2-word Latest keywords (3 ok when needed); mix broad + tighter; do not copy the agenda sentence.",
    };
    const plan = await doPlan(agenda, planOpts);
    if (!plan.ok) {
      searchErrors.push({ query: "(replan)", message: plan.message });
      return false;
    }
    queries = plan.queries;
    plannedBy = llmProvider;
    planModel = plan.model;
    llmUsage = addTokenUsage(llmUsage, plan.usage);
    queryIndex = 0;
    consecutiveZeroAdds = 0;
    return queries.length > 0;
  }

  const coolIds = new Set<string>();

  try {
    while (
      !aborted() &&
      cool.length < targetCool &&
      bucketAttempts < MAX_BUCKET_ATTEMPTS
    ) {
      // Fill hard-filter bucket (no LLM).
      while (!aborted() && bucket.length < bucketSize) {
        if (searchCalls >= MAX_SEARCH_CALLS) break;

        if (queries.length === 0) {
          const ok = await maybeReplan("cycle");
          if (!ok) break;
        }

        // Stuck under bucket with no new survivors → broaden once early.
        if (
          !replanned &&
          bucket.length < bucketSize &&
          consecutiveZeroAdds >= Math.max(queries.length, 3)
        ) {
          const ok = await maybeReplan("stalled");
          if (ok) continue;
        }

        if (queryIndex >= queries.length) {
          const ok = await maybeReplan("cycle");
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

        if (deps.creditGate && !(await deps.creditGate())) {
          creditStopped = true;
          break;
        }

        const query = queries[queryIndex];
        queryIndex += 1;
        searchCalls += 1;

        track(
          "searching",
          `Cand. ${bucket.length}/${bucketSize} · searching X…`,
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
          if (
            result.error === "rate_limited" ||
            result.error === "credits_depleted" ||
            result.error === "unauthorized"
          ) {
            // Quota window, credits, or bearer failures are terminal for the
            // remainder of a run — further calls are doomed; fail fast with a
            // clear reason instead of cycling all queries and misreporting
            // 'supply exhausted'.
            if (result.error === "rate_limited") rateLimited = true;
            else terminalError = result.error;
            searchErrors.push({ query, message: result.message });
            break;
          }
          searchErrors.push({ query, message: result.message });
          continue;
        }

        track(
          "filtering",
          `Cand. ${bucket.length}/${bucketSize} · filters…`,
          { candidates: bucket.length, coolCount: 0 },
        );

        const fresh = result.threads.filter((t) => {
          if (!t.id || seenIds.has(t.id)) return false;
          seenIds.add(t.id);
          return true;
        });
        const afterCool = filterThreadsByCooldown(
          fresh,
          cooled,
          blockedConversations,
        );
        const afterSelf = filterSelfReplies(afterCool.threads);
        const afterLinks = filterOutboundLinks(afterSelf.threads);
        const afterLang = filterByLanguage(afterLinks.threads, preferredLanguage);
        const afterEmDash = filterEmDashes(afterLang.threads, { dropEmDashes });
        const afterAutomated = filterAutomatedAccounts(afterEmDash.threads, {
          dropAutomatedAccounts,
        });
        const afterLen = filterThreadsByLength(
          afterAutomated.threads,
          maxChars,
          { dropArticles },
        );

        funnelCounts.raw += result.threads.length;
        funnelCounts.afterDedupe += fresh.length;
        funnelCounts.afterCooldown += afterCool.threads.length;
        funnelCounts.afterSelfReply += afterSelf.threads.length;
        funnelCounts.afterLinks += afterLinks.threads.length;
        funnelCounts.afterLength += afterLen.threads.length;
        linkFilteredTotal += afterLinks.linkFilteredCount;
        emDashFilteredTotal += afterEmDash.emDashFilteredCount;
        automatedFilteredTotal += afterAutomated.automatedFilteredCount;
        languageFilteredTotal += afterLang.languageFilteredCount;

        const beforeFill = bucket.length;
        let authorDedupeSkipped = 0;
        for (const t of afterLen.threads) {
          if (bucket.length >= bucketSize) break;
          const key = normalizeAuthorKey(t.author);
          if (!key || seenAuthors.has(key)) {
            if (key) authorDedupeSkipped += 1;
            continue;
          }
          seenAuthors.add(key);
          bucket.push(t);
        }
        const added = bucket.length - beforeFill;

        if (added > 0) {
          consecutiveZeroAdds = 0;
          // Skip bare progress when this page added nothing (stops Cand. 0/5 spam).
          track(
            "partial",
            `Cand. ${bucket.length}/${bucketSize}`,
            {
              candidates: bucket.length,
              coolCount: 0,
              detail: {
                raw: result.threads.length,
                afterCooldown: afterCool.threads.length,
                afterSelfReply: afterSelf.threads.length,
                selfReplyFiltered: afterSelf.selfReplyFilteredCount,
                afterLinks: afterLinks.threads.length,
                linkFiltered: afterLinks.linkFilteredCount,
                emDashFiltered: afterEmDash.emDashFilteredCount,
                automatedFiltered: afterAutomated.automatedFilteredCount,
                languageFiltered: afterLang.languageFilteredCount,
                afterLength: afterLen.threads.length,
                authorDedupeSkipped,
                added,
              },
            },
          );
        } else {
          consecutiveZeroAdds += 1;
        }
      }

      if (aborted()) {
        stopReason = "aborted";
        break;
      }

      if (creditStopped) {
        stopReason = "credits_exhausted";
        break;
      }

      // Empty underfill: nothing to score.
      if (bucket.length === 0) {
        stopReason = "exhausted";
        break;
      }

      // Partial underfill: triage what we have once, then stop (no refill spam).
      const isPartial = bucket.length < bucketSize;

      bucketAttempts += 1;

      // Attach OP text for replies before LLM triage (promo-root skip).
      const hydrated = await doHydrate({
        threads: bucket,
        session,
        signal: opts.signal,
      });
      if (aborted()) {
        stopReason = "aborted";
        break;
      }
      unhydratedReplyCount += hydrated.unhydratedReplyCount;

      // Drop same-author replies revealed only after hydrate (missing inReplyToScreenName).
      const afterHydrateSelf = filterSelfReplies(hydrated.threads);
      funnelCounts.afterHydrateSelfReply += afterHydrateSelf.threads.length;
      // Re-check language now that reply-parent OP text is available (#121).
      const afterHydrateLang = filterByLanguage(
        afterHydrateSelf.threads,
        preferredLanguage,
      );
      const forTriage = afterHydrateLang.threads;
      languageFilteredTotal += afterHydrateLang.languageFilteredCount;

      if (forTriage.length === 0) {
        if (isPartial && afterHydrateLang.languageFilteredCount === 0) {
          bucket = [];
          stopReason = "exhausted";
          break;
        }
        track(
          "filtering",
          "0 candidates after post-hydrate self-reply + language filter — discarding bucket…",
          {
            candidates: 0,
            coolCount: cool.length,
            detail: {
              bucketAttempt: bucketAttempts,
              selfReplyFilteredPostHydrate:
                afterHydrateSelf.selfReplyFilteredCount,
              languageFilteredPostHydrate:
                afterHydrateLang.languageFilteredCount,
            },
          },
        );
        bucket = [];
        continue;
      }

      track(
        "triaging",
        isPartial
          ? `Scout is scoring partial bucket of ${forTriage.length}/${bucketSize} candidates…`
          : `Scout is scoring bucket of ${forTriage.length} candidates…`,
        {
          candidates: forTriage.length,
          coolCount: cool.length,
          detail: {
            bucketAttempt: bucketAttempts,
            partial: isPartial,
            ...(afterHydrateSelf.selfReplyFilteredCount > 0
              ? {
                  selfReplyFilteredPostHydrate:
                    afterHydrateSelf.selfReplyFilteredCount,
                }
              : {}),
          },
        },
      );

      const triaged = await doTriage({
        agenda,
        threads: forTriage,
      });
      if (triaged.warning) triageWarning = triaged.warning;
      llmUsage = addTokenUsage(llmUsage, triaged.usage);
      funnelCounts.afterTriage += triaged.threads.length;

      for (const id of collectBaitConversationIds(triaged.threads)) {
        baitConversationIds.add(id);
      }
      if (baitConversationIds.size) {
        let purged = false;
        const kept: ThreadCard[] = [];
        for (const t of cool) {
          if (replyUnderBaitConversation(t, baitConversationIds)) {
            purged = true;
            if (t.id) coolIds.delete(t.id);
            const key = normalizeAuthorKey(t.author);
            if (key) coolAuthors.delete(key);
          } else {
            kept.push(t);
          }
        }
        if (purged) cool = kept;
      }

      const newlyCool = triaged.threads.filter(
        (t) =>
          isCoolThread(t) &&
          t.id &&
          !coolIds.has(t.id) &&
          !threadHasExcludedTag(t, excludedTags) &&
          !replyUnderBaitConversation(t, baitConversationIds),
      );
      if (newlyCool.length === 0) {
        if (isPartial) {
          bucket = [];
          stopReason = "exhausted";
          break;
        }
        track(
          "filtering",
          "0 cool — discarding bucket and refilling…",
          {
            candidates: 0,
            coolCount: cool.length,
            detail: { bucketAttempt: bucketAttempts },
          },
        );
        bucket = [];
        continue;
      }

      const coolBefore = cool.length;
      for (const t of newlyCool) {
        if (cool.length >= targetCool) break;
        const key = normalizeAuthorKey(t.author);
        if (!key || coolAuthors.has(key)) continue;
        cool.push(t);
        coolIds.add(t.id);
        coolAuthors.add(key);
      }
      track("partial", `Cool ${cool.length}/${targetCool}`, {
        threads: newlyCool,
        coolCount: cool.length,
        candidates: bucketSize,
        targetCool,
      });

      // Persist as cools qualify so Stop/abort does not lose them.
      if (cool.length > coolBefore) {
        try {
          await doSaveCache({
            savedAt: new Date().toISOString(),
            agenda: agenda || undefined,
            queries,
            threads: cool,
            message: `Cool ${cool.length}/${targetCool}`,
            triageWarning,
            pipelineCounts: funnelCounts,
          });
        } catch (err) {
          console.error("Failed to persist Scout cools mid-run:", err);
        }
      }

      if (cool.length >= targetCool) {
        bucket = [];
        stopReason = "target";
        break;
      }
      if (isPartial) {
        bucket = [];
        stopReason = "exhausted";
        break;
      }
      bucket = [];
    }

    if (aborted()) stopReason = "aborted";
    else if (creditStopped) stopReason = "credits_exhausted";
    else if (cool.length >= targetCool) stopReason = "target";
    else if (rateLimited) stopReason = "rate_limited";
    else if (terminalError) stopReason = "terminal_error";
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
    stopReason === "target"
      ? `Scout found ${cool.length} cool thread${cool.length === 1 ? "" : "s"}.`
      : stopReason === "aborted"
        ? `Scout stopped — ${cool.length} cool thread${cool.length === 1 ? "" : "s"}.`
        : stopReason === "credits_exhausted"
          ? "Scout stopped — this month's credits are used; upgrade on Usage & Billing, or wait until the next UTC month."
          : stopReason === "terminal_error"
            ? terminalError === "credits_depleted"
              ? "Scout stopped — X API credits depleted; top up credits before retrying."
              : "Scout stopped — X API rejected the bearer (unauthorized); refresh X_API_BEARER_TOKEN and retry."
            : stopReason === "rate_limited"
              ? "Scout stopped — X API rate limit reached (quota window exhausted); retry after it resets."
              : `Scout finished — ${cool.length} cool thread${cool.length === 1 ? "" : "s"} (supply exhausted).`;

  const linkWarning = linkFilteredTotal
    ? `Dropped ${linkFilteredTotal} posts with outbound links.`
    : undefined;
  const emDashWarning = emDashFilteredTotal
    ? `Dropped ${emDashFilteredTotal} posts with em dashes.`
    : undefined;
  const automatedWarning = automatedFilteredTotal
    ? `Dropped ${automatedFilteredTotal} automated accounts.`
    : undefined;

  const done = track("done", stopMessage, {
    threads: cool,
    queries,
    coolCount: cool.length,
    targetCool,
    bucketSize,
    candidates: bucket.length,
    stopReason,
    triageWarning,
    linkFiltered: linkFilteredTotal,
    linkWarning,
    emDashFiltered: emDashFilteredTotal,
    emDashWarning,
    automatedFiltered: automatedFilteredTotal,
    automatedWarning,
    languageFiltered: languageFilteredTotal,
    pipelineCounts: funnelCounts,
    errors: searchErrors.length ? searchErrors : undefined,
    plannedBy,
    model: planModel,
    llmProvider,
    llmUsage,
    unhydratedReplyCount,
    opencodeTurns: toOpenCodeTurns(events),
  });
  if (llmUsage) {
    console.info(
      `[llm] scout_total provider=${llmProvider} prompt_tokens=${llmUsage.prompt_tokens} completion_tokens=${llmUsage.completion_tokens} total_tokens=${llmUsage.total_tokens}`,
    );
  }

  try {
    await doSaveCache({
      savedAt: done.at,
      agenda: agenda || undefined,
      queries,
      threads: cool,
      message: done.message,
      triageWarning,
      linkWarning,
      pipelineCounts: funnelCounts,
    });
  } catch (err) {
    console.error("Failed to persist last Scout collect:", err);
  }

  return { ok: true, event: done };
}
