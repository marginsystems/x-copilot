/** Streaming Scout collector — hard-filter into buckets, then LLM-qualify. */
import { randomUUID } from "node:crypto";
import {
  getAuthorKeysForScoutFilter,
  getCooledAuthorKeys,
  getEverInteractedConversationIds,
} from "./interactionStore.js";
import { normalizeAuthorKey } from "./interactionCooldown.js";
import { applyScoutSearchHardFilters } from "./scoutCollectHardFilters.js";
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
import { isAbortError, sleep } from "./scoutAbort.js";
import { filterPostHydrateThreads } from "./scoutPipeline.js";
import {
  COLLECT_COUNT_PER_QUERY,
  COLLECT_QUERY_DELAY_MS,
  MAX_BUCKET_ATTEMPTS,
  MAX_SEARCH_CALLS,
  clampBucketSize,
  clampTargetCool,
  isCoolThread,
  withScoutSearchExclusions,
} from "./scoutPolicy.js";
import { ScoutCollectCursors } from "./scoutCollectCursors.js";
import {
  admitScoutPage,
  appendScoutTank,
  drainScoutReserve,
  type ScoutReserve,
} from "./scoutCollectReserve.js";
import {
  addScoutRejectionCounts,
  emptyScoutRejectionCounts,
  persistScoutRunRecordSafe,
  saveScoutRunRecord,
  type ScoutRunRecordInput,
} from "./scoutRunStore.js";
import { preferRootTargets } from "./scoutTarget.js";
import type {
  ScoutCollectEvent,
  ScoutCollectStageId,
  ScoutFilters,
  ScoutPipelineCounts,
  ScoutStopReason,
} from "./scoutTypes.js";
import {
  normalizeAvoidPrompt,
  normalizePreferredLanguageCode,
  collectBaitConversationIds,
  replyUnderBaitConversation,
  resolveExcludedAccounts,
  resolveExcludedTags,
  resolveMaxThreadCharsFromFilters,
  threadHasExcludedTag,
} from "./threadFilters.js";
import { triageThreads } from "./threadTriage.js";
import { hydrateReplyParents } from "./tweetLookup.js";
import type { ThreadCard } from "./threadCard.js";
import { searchTimelinePages } from "./xSearch.js";
import { getXApiCredsFromEnv, type XApiCreds } from "./xApi.js";

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
  saveScoutRunRecord?: (record: ScoutRunRecordInput) => void | Promise<void>;
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
  /** Desk user whose cooldowns, blocked conversations, and tank this run uses. */
  userId?: string;
  /** Daily takeoff associated with this run, when one was claimed. */
  sortieId?: string;
  session?: XApiCreds;
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
  const doSaveRun = deps.saveScoutRunRecord ?? saveScoutRunRecord;
  const doHydrate = deps.hydrateReplyParents ?? hydrateReplyParents;
  const doSleep = deps.sleep ?? sleep;
  // Store-backed deps require a user; stubs ignore it.
  const userId = opts.userId?.trim() ?? "";
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const usedQueries = new Set<string>();
  const seenIds = new Set<string>();
  const countedDuplicateIds = new Set<string>();
  const acceptedIds = new Set<string>();
  let searchCalls = 0;
  let usableAdditions = 0;
  let coolAdditions = 0;
  let runPersisted = false;
  const rejectionCounts = emptyScoutRejectionCounts();
  const persistRun = async (
    stopReason: string,
    fallbackQueries: string[] = [],
  ): Promise<void> => {
    if (!userId || runPersisted) return;
    runPersisted = true;
    await persistScoutRunRecordSafe(doSaveRun, {
      id: runId,
      userId,
      sortieId: opts.sortieId,
      startedAt,
      finishedAt: new Date().toISOString(),
      queries: usedQueries.size ? [...usedQueries] : fallbackQueries,
      uniqueCandidateIds: seenIds.size,
      rejectionCounts,
      usableAdditions,
      coolAdditions,
      searchCalls,
      stopReason,
    });
  };

  const session = opts.session ?? getXApiCredsFromEnv();
  if (!session.bearerToken) {
    await persistRun("missing_credentials", opts.queries);
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
      await persistRun("missing_agenda");
      return {
        ok: false,
        status: 400,
        error: "missing_agenda",
        message: "Pass { agenda: string } or { queries: string[] }.",
      };
    }
    if (!deepseekConfigured()) {
      await persistRun("missing_llm_key");
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
      await persistRun("aborted", queries);
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
      await persistRun(plan.error, queries);
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
  const dropOutboundLinks = opts.filters?.dropOutboundLinks !== false;
  const dropNativeMedia = opts.filters?.dropNativeMedia !== false;
  const dropHashtags = opts.filters?.dropHashtags !== false;
  const dropEmDashes = opts.filters?.dropEmDashes !== false;
  const dropProfanity = opts.filters?.dropProfanity !== false;
  const avoidPrompt = normalizeAvoidPrompt(opts.filters?.avoidPrompt);
  const dropAutomatedAccounts = opts.filters?.dropAutomatedAccounts !== false;
  const filterByMinViews = opts.filters?.filterByMinViews !== false;
  const minViews = opts.filters?.minViews;
  const preferredLanguage = normalizePreferredLanguageCode(
    opts.filters?.preferredLanguage,
  );
  const excludedTags = resolveExcludedTags(opts.filters?.excludedTags);
  const excludedAccounts = resolveExcludedAccounts(opts.filters?.excludedAccounts);
  // Tests often stub getCooledAuthorKeys only; production uses lifetime+24h filter.
  const cooled =
    deps.getCooledAuthorKeys && !deps.getAuthorKeysForScoutFilter
      ? await doGetCooled({ userId })
      : await doGetFilterKeys({
          dedupeAccounts: opts.filters?.dedupeAccounts,
          userId,
        });
  // Suppress conversations we've Marked or Not interested (OP + sibling replies).
  // Tests that stub only getCooledAuthorKeys stay isolated from the durable store.
  const blockedConversations =
    deps.getCooledAuthorKeys &&
    !deps.getAuthorKeysForScoutFilter &&
    !deps.getBlockedConversationIds &&
    !deps.getEverInteractedConversationIds
      ? new Set<string>()
      : await doGetConversationIds({ userId });

  let cool: ThreadCard[] = [];
  /** Per-run dedupe state (first kept wins across bucket refills). */
  const seenAuthors = new Set<string>();
  const coolAuthors = new Set<string>();
  const baitConversationIds = new Set<string>();
  const articleConversationIds = new Set<string>();
  let bucket: ThreadCard[] = [];
  const reserve: ScoutReserve = [];
  const searchErrors: Array<{ query: string; message: string }> = [];
  let triageWarning: string | undefined;
  let stopReason: ScoutStopReason = "exhausted";
  let rateLimited = false;
  let creditStopped = false;
  let terminalError: string | undefined;
  let unhydratedReplyCount = 0;
  let queryIndex = 0;
  let replanned = false;
  const queryCursors = new ScoutCollectCursors();
  let bucketAttempts = 0;
  let consecutiveZeroAdds = 0;
  let linkFilteredTotal = 0;
  let emDashFilteredTotal = 0;
  let profanityFilteredTotal = 0;
  let automatedFilteredTotal = 0;
  let excludedAccountFilteredTotal = 0;
  let languageFilteredTotal = 0;
  let minViewsFilteredTotal = 0;
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
        " Stuck under candidate bucket — broaden; prefer shorter high-recall 2-word Latest keywords (3 ok when needed); mix broad + tighter; do not copy the agenda sentence; at least two queries must contain an agenda noun.",
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
        const drained = drainScoutReserve({
          reserve,
          bucket,
          bucketSize,
          seenAuthors,
          acceptedIds,
          blockedConversations,
        });
        if (drained.added) consecutiveZeroAdds = 0;
        addScoutRejectionCounts(rejectionCounts, {
          authorDedupe: drained.authorDedupe,
          authorless: drained.authorless,
        });
        if (bucket.length >= bucketSize) break;
        if (searchCalls >= MAX_SEARCH_CALLS) break;

        if (queries.length === 0) {
          const ok = await maybeReplan("cycle");
          if (!ok) break;
        }

        // Stuck under bucket with no new survivors → broaden once, then score
        // the partial bucket instead of cycling paid pages.
        if (
          bucket.length < bucketSize &&
          consecutiveZeroAdds >= Math.max(queries.length, 3)
        ) {
          if (replanned) break;
          const ok = await maybeReplan("stalled");
          if (ok) continue;
        }

        if (queryIndex >= queries.length) {
          const ok = await maybeReplan("cycle");
          if (ok) {
            // fresh list from replan
          } else if (queries.length > 0) {
            queryIndex = 0; // cycle existing queries
            if (
              !queryCursors.hasAvailable(
                queries.map((query) => withScoutSearchExclusions(query)),
              )
            ) {
              break;
            }
          } else {
            break;
          }
        }

        if (queryIndex >= queries.length) break;

        const query = queries[queryIndex];
        queryIndex += 1;
        const searchQuery = withScoutSearchExclusions(query);
        const resume = queryCursors.resume(searchQuery);
        if (!resume) continue;

        if (searchCalls > 0) {
          await doSleep(COLLECT_QUERY_DELAY_MS, opts.signal);
        }

        if (deps.creditGate && !(await deps.creditGate())) {
          creditStopped = true;
          break;
        }

        searchCalls += 1;
        usedQueries.add(query);

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
          query: searchQuery,
          count: COLLECT_COUNT_PER_QUERY,
          maxPages: 1,
          cursor: resume.cursor,
          startTime: resume.startTime,
          expandReferenced: true,
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

        queryCursors.update(searchQuery, result.bottomCursor);
        track(
          "filtering",
          `Cand. ${bucket.length}/${bucketSize} · filters…`,
          { candidates: bucket.length, coolCount: 0 },
        );

        let missingIdCount = 0;
        const duplicateIds = new Set<string>();
        const fresh = result.threads.filter((t) => {
          if (!t.id) {
            missingIdCount += 1;
            return false;
          }
          if (seenIds.has(t.id)) {
            if (!countedDuplicateIds.has(t.id)) {
              countedDuplicateIds.add(t.id);
              duplicateIds.add(t.id);
            }
            return false;
          }
          seenIds.add(t.id);
          return true;
        });
        const page = applyScoutSearchHardFilters({
          threads: fresh,
          cooled,
          blockedConversations,
          dropOutboundLinks,
          dropNativeMedia,
          dropHashtags,
          preferredLanguage,
          dropEmDashes,
          dropProfanity,
          dropAutomatedAccounts,
          excludedAccounts,
          articleConversationIds,
          filterByMinViews,
          minViews,
          maxChars,
          dropArticles,
        });
        addScoutRejectionCounts(rejectionCounts, page.rejections);
        funnelCounts.raw += result.threads.length;
        funnelCounts.afterDedupe += fresh.length;
        funnelCounts.afterCooldown += page.afterCooldown;
        funnelCounts.afterSelfReply += page.afterSelfReply;
        funnelCounts.afterLinks += page.afterLinks;
        funnelCounts.afterLength += page.afterLength;
        linkFilteredTotal += page.linkFilteredCount;
        emDashFilteredTotal += page.emDashFilteredCount;
        profanityFilteredTotal += page.profanityFilteredCount;
        automatedFilteredTotal += page.automatedFilteredCount;
        excludedAccountFilteredTotal += page.excludedAccountFilteredCount;
        languageFilteredTotal += page.languageFilteredCount;
        minViewsFilteredTotal += page.minViewsFilteredCount;
        funnelCounts.minViewsFiltered = minViewsFilteredTotal;

        const admitted = admitScoutPage({
          candidates: page.threads,
          reserve,
          bucket,
          bucketSize,
          seenAuthors,
          acceptedIds,
        });
        addScoutRejectionCounts(rejectionCounts, {
          duplicateOrMissingId:
            missingIdCount +
            [...duplicateIds].filter((id) => acceptedIds.has(id)).length,
          authorDedupe: admitted.authorDedupe,
          authorless: admitted.authorless,
          bucketFull: admitted.bucketFull,
        });

        if (admitted.added > 0) {
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
                afterCooldown: page.afterCooldown,
                afterSelfReply: page.afterSelfReply,
                selfReplyFiltered: page.rejections.selfReply ?? 0,
                afterLinks: page.afterLinks,
                linkFiltered: page.linkFilteredCount,
                emDashFiltered: page.emDashFilteredCount,
                profanityFiltered: page.profanityFilteredCount,
                automatedFiltered: page.automatedFilteredCount,
                languageFiltered: page.languageFilteredCount,
                afterLength: page.afterLength,
                authorDedupeSkipped: admitted.authorDedupe,
                added: admitted.added,
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

      const {
        afterSelfReply: afterHydrateSelf,
        afterMinViews: afterHydrateMinViews,
        afterLinks: afterHydrateLinks,
        afterMedia: afterHydrateMedia,
        afterHashtags: afterHydrateHashtags,
        afterProfanity: afterHydrateProfanity,
        afterLanguage: afterHydrateLang,
        afterLength: afterHydrateLen,
      } = filterPostHydrateThreads({
        threads: hydrated.threads,
        preferredLanguage,
        maxChars,
        lengthOptions: {
          dropArticles,
          articleIds: articleConversationIds,
        },
        dropOutboundLinks,
        dropNativeMedia,
        dropHashtags,
        dropProfanity,
        filterByMinViews,
        minViews,
      });
      const forTriageIds = new Set(afterHydrateLen.threads.map((t) => t.id));
      for (const t of bucket) {
        if (!forTriageIds.has(t.id)) acceptedIds.delete(t.id);
      }
      funnelCounts.afterHydrateSelfReply += afterHydrateSelf.threads.length;
      addScoutRejectionCounts(rejectionCounts, {
        selfReply: afterHydrateSelf.selfReplyFilteredCount,
        views: afterHydrateMinViews.minViewsFilteredCount,
        links: afterHydrateLinks.linkFilteredCount,
        media: afterHydrateMedia.mediaFilteredCount,
        hashtags: afterHydrateHashtags.hashtagFilteredCount,
        profanity: afterHydrateProfanity.profanityFilteredCount,
        language: afterHydrateLang.languageFilteredCount,
        articles: afterHydrateLen.articleFilteredCount,
        length:
          afterHydrateLen.filteredCount - afterHydrateLen.articleFilteredCount,
      });
      linkFilteredTotal += afterHydrateLinks.linkFilteredCount;
      profanityFilteredTotal += afterHydrateProfanity.profanityFilteredCount;
      minViewsFilteredTotal += afterHydrateMinViews.minViewsFilteredCount;
      funnelCounts.minViewsFiltered = minViewsFilteredTotal;
      const forTriage = afterHydrateLen.threads;
      languageFilteredTotal += afterHydrateLang.languageFilteredCount;

      if (forTriage.length === 0) {
        const emptiedByRefillableFilter =
          afterHydrateSelf.selfReplyFilteredCount === 0 &&
          (afterHydrateLinks.linkFilteredCount > 0 ||
            afterHydrateMedia.mediaFilteredCount > 0 ||
            afterHydrateHashtags.hashtagFilteredCount > 0 ||
            afterHydrateProfanity.profanityFilteredCount > 0 ||
            afterHydrateMinViews.minViewsFilteredCount > 0);
        if (!emptiedByRefillableFilter) {
          bucket = [];
          stopReason = "exhausted";
          break;
        }
        track(
          "filtering",
          "0 candidates after post-hydrate filters — discarding bucket…",
          {
            candidates: 0,
            coolCount: cool.length,
            detail: {
              bucketAttempt: bucketAttempts,
              selfReplyFilteredPostHydrate:
                afterHydrateSelf.selfReplyFilteredCount,
              linkFilteredPostHydrate: afterHydrateLinks.linkFilteredCount,
              profanityFilteredPostHydrate:
                afterHydrateProfanity.profanityFilteredCount,
              minViewsFilteredPostHydrate:
                afterHydrateMinViews.minViewsFilteredCount,
              languageFilteredPostHydrate:
                afterHydrateLang.languageFilteredCount,
              lengthFilteredPostHydrate: afterHydrateLen.filteredCount,
              articleFilteredPostHydrate: afterHydrateLen.articleFilteredCount,
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
      usableAdditions += forTriage.length;

      const triaged = await doTriage({
        agenda,
        avoid: avoidPrompt,
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
          if (
            (t.id && baitConversationIds.has(t.id)) ||
            replyUnderBaitConversation(t, baitConversationIds)
          ) {
            purged = true;
            coolAdditions -= 1;
            if (t.id) coolIds.delete(t.id);
            const key = normalizeAuthorKey(t.author);
            if (key) coolAuthors.delete(key);
          } else {
            kept.push(t);
          }
        }
        if (purged) cool = kept;
      }

      const newlyCool = preferRootTargets(
        triaged.threads.filter(
          (t) =>
            isCoolThread(t, { agendaSet: Boolean(agenda) }) &&
            !threadHasExcludedTag(t, excludedTags) &&
            !replyUnderBaitConversation(t, baitConversationIds),
        ),
      ).filter((t) => {
        const key = normalizeAuthorKey(t.author);
        return (
          Boolean(t.id) &&
          !coolIds.has(t.id) &&
          !coolAuthors.has(key) &&
          !cooled.has(key) &&
          !blockedConversations.has(t.id) &&
          !(t.conversationId && blockedConversations.has(t.conversationId)) &&
          !baitConversationIds.has(t.id)
        );
      });
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
      coolAdditions += appendScoutTank({
        tank: cool,
        candidates: newlyCool,
        tankIds: coolIds,
        tankAuthors: coolAuthors,
        acceptedIds,
      });
      track("partial", `Cool ${cool.length}/${targetCool}`, {
        threads: newlyCool,
        coolCount: cool.length,
        candidates: bucketSize,
        targetCool,
      });

      // Persist as cools qualify so Stop/abort does not lose them.
      if (cool.length > coolBefore) {
        try {
          await doSaveCache(
            {
              savedAt: new Date().toISOString(),
              agenda: agenda || undefined,
              queries,
              threads: cool,
              message: `Cool ${cool.length}/${targetCool}`,
              triageWarning,
              pipelineCounts: funnelCounts,
            },
            { userId },
          );
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
      await persistRun("collect_failed", queries);
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

  await persistRun(stopReason, queries);
  const linkWarning = linkFilteredTotal
    ? `Dropped ${linkFilteredTotal} posts with outbound links.`
    : undefined;
  const emDashWarning = emDashFilteredTotal
    ? `Dropped ${emDashFilteredTotal} posts with em dashes.`
    : undefined;
  const profanityWarning = profanityFilteredTotal
    ? `Dropped ${profanityFilteredTotal} posts with profanity.`
    : undefined;
  const automatedWarning = automatedFilteredTotal
    ? `Dropped ${automatedFilteredTotal} automated accounts.`
    : undefined;
  const excludedAccountWarning = excludedAccountFilteredTotal
    ? `Dropped ${excludedAccountFilteredTotal} excluded accounts.`
    : undefined;
  const minViewsWarning = minViewsFilteredTotal
    ? `Dropped ${minViewsFilteredTotal} posts below the minimum view floor.`
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
    profanityFiltered: profanityFilteredTotal,
    profanityWarning,
    automatedFiltered: automatedFilteredTotal,
    automatedWarning,
    excludedAccountFiltered: excludedAccountFilteredTotal,
    excludedAccountWarning,
    languageFiltered: languageFilteredTotal,
    minViewsFiltered: minViewsFilteredTotal,
    minViewsWarning,
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
    await doSaveCache(
      {
        savedAt: done.at,
        agenda: agenda || undefined,
        queries,
        threads: cool,
        message: done.message,
        triageWarning,
        linkWarning,
        pipelineCounts: funnelCounts,
      },
      { userId },
    );
  } catch (err) {
    console.error("Failed to persist last Scout collect:", err);
  }

  return { ok: true, event: done };
}
