/**
 * Scout search runner — same pipeline as /api/search with stage callbacks.
 */
import {
  getAuthorKeysForScoutFilter,
} from "./interactionStore.js";
import { filterThreadsByCooldown } from "./interactionCooldown.js";
import { getBlockedConversationIds } from "./dismissalStore.js";
import { toOpenCodeTurns, type ScoutStageEvent } from "./opencodeAdapter.js";
import {
  deepseekConfigured,
  type LlmProvider,
  type TokenUsage,
  addTokenUsage,
} from "./deepseek.js";
import { planQueriesFromAgenda } from "./queryPlan.js";
import { saveScoutCache } from "./scoutCache.js";
import { filterPostHydrateThreads } from "./scoutPipeline.js";
import {
  filterAutomatedAccounts,
  filterExcludedAccounts,
  filterByLanguage,
  filterEmDashes,
  filterOutboundLinks,
  filterSelfReplies,
  filterThreadsByLength,
  normalizePreferredLanguageCode,
  resolveExcludedAccounts,
  resolveMaxThreadCharsFromFilters,
} from "./threadFilters.js";
import { hydrateReplyParents } from "./tweetLookup.js";
import { triageThreads } from "./threadTriage.js";
import type { ThreadCard } from "./threadCard.js";
import type {
  ScoutFilters,
  ScoutPipelineCounts,
  ScoutStageId,
} from "./scoutTypes.js";
import { searchMany } from "./xSearch.js";
import { getXApiCredsFromEnv, type XApiCreds } from "./xApi.js";

export type ScoutEvent = ScoutStageEvent & {
  stage: ScoutStageId;
  threads?: ThreadCard[];
  queries?: string[];
  errors?: Array<{ query: string; message: string }>;
  plannedBy?: "client" | LlmProvider;
  model?: string;
  triageModel?: string;
  llmProvider?: LlmProvider;
  llmUsage?: TokenUsage;
  triageWarning?: string;
  cooldownFiltered?: number;
  cooldownAuthors?: string[];
  cooldownWarning?: string;
  selfReplyFiltered?: number;
  linkFiltered?: number;
  linkWarning?: string;
  emDashFiltered?: number;
  emDashWarning?: string;
  automatedFiltered?: number;
  automatedWarning?: string;
  excludedAccountFiltered?: number;
  excludedAccountWarning?: string;
  languageFiltered?: number;
  lengthFiltered?: number;
  lengthWarning?: string;
  unhydratedReplyCount?: number;
  pipelineCounts?: ScoutPipelineCounts;
  opencodeTurns?: ReturnType<typeof toOpenCodeTurns>;
};

/** Compact funnel for status: `48 → 36 → 34 → 28 → 22 → 18 → 15 → 12`. */
export function formatPipelineFunnel(counts: ScoutPipelineCounts): string {
  return `${counts.raw} → ${counts.afterDedupe} → ${counts.afterCooldown} → ${counts.afterSelfReply} → ${counts.afterLinks} → ${counts.afterLength} → ${counts.afterHydrateSelfReply} → ${counts.afterTriage}`;
}

export type ScoutRunResult =
  | { ok: true; event: ScoutEvent }
  | { ok: false; status: number; error: string; message: string };

/** Test seam: stub the X search / store reads without touching the network. */
export type ScoutRunDeps = {
  searchMany?: typeof searchMany;
  getAuthorKeysForScoutFilter?: typeof getAuthorKeysForScoutFilter;
  getBlockedConversationIds?: typeof getBlockedConversationIds;
  hydrateReplyParents?: typeof hydrateReplyParents;
  triageThreads?: typeof triageThreads;
  saveScoutCache?: typeof saveScoutCache;
};

function emit(
  onEvent: ((e: ScoutEvent) => void) | undefined,
  stage: ScoutStageId,
  message: string,
  detail?: unknown,
): ScoutEvent {
  const event: ScoutEvent = {
    agent: "scout",
    stage,
    message,
    detail,
    at: new Date().toISOString(),
  };
  onEvent?.(event);
  return event;
}

export async function runScoutSearch(opts: {
  agenda?: string;
  queries?: string[];
  filters?: ScoutFilters;
  session?: XApiCreds;
  onEvent?: (event: ScoutEvent) => void;
  deps?: ScoutRunDeps;
}): Promise<ScoutRunResult> {
  const deps = opts.deps ?? {};
  const doSearch = deps.searchMany ?? searchMany;
  const doGetFilterKeys =
    deps.getAuthorKeysForScoutFilter ?? getAuthorKeysForScoutFilter;
  const doGetConversationIds =
    deps.getBlockedConversationIds ?? getBlockedConversationIds;
  const doHydrate = deps.hydrateReplyParents ?? hydrateReplyParents;
  const doTriage = deps.triageThreads ?? triageThreads;
  const doSaveCache = deps.saveScoutCache ?? saveScoutCache;

  const session = opts.session ?? getXApiCredsFromEnv();
  if (!session.bearerToken) {
    return {
      ok: false,
      status: 401,
      error: "missing_credentials",
      message: "Set X_API_BEARER_TOKEN in .env (Pay Per Use app bearer).",
    };
  }

  const events: ScoutStageEvent[] = [];
  const track = (stage: ScoutStageId, message: string, detail?: unknown) => {
    const ev = emit(opts.onEvent, stage, message, detail);
    events.push(ev);
    return ev;
  };

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
    const plan = await planQueriesFromAgenda(agenda);
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
    track("planning", "Scout is using client-provided queries…", { queries });
  }

  const result = await doSearch(queries, {
    session,
    countPerQuery: 20,
    onQuery: (index, qTotal, query) => {
      track(
        "searching",
        `Scout is searching X (query ${index}/${qTotal})…`,
        { query, index, total: qTotal },
      );
    },
  });

  track("filtering", "Scout is applying cooldown + length filters…");
  const cooled = await doGetFilterKeys({
    dedupeAccounts: opts.filters?.dedupeAccounts,
  });
  const blockedConversations = await doGetConversationIds();
  const filtered = filterThreadsByCooldown(
    result.threads,
    cooled,
    blockedConversations,
  );
  const afterSelf = filterSelfReplies(filtered.threads);
  const dropOutboundLinks = opts.filters?.dropOutboundLinks !== false;
  const afterLinks = filterOutboundLinks(afterSelf.threads, {
    dropOutboundLinks,
  });
  const preferredLanguage = normalizePreferredLanguageCode(
    opts.filters?.preferredLanguage,
  );
  const afterLang = filterByLanguage(afterLinks.threads, preferredLanguage);
  const dropEmDashes = opts.filters?.dropEmDashes !== false;
  const afterEmDash = filterEmDashes(afterLang.threads, { dropEmDashes });
  const dropAutomatedAccounts = opts.filters?.dropAutomatedAccounts !== false;
  const afterAutomated = filterAutomatedAccounts(afterEmDash.threads, {
    dropAutomatedAccounts,
  });
  const afterExcludedAccounts = filterExcludedAccounts(
    afterAutomated.threads,
    resolveExcludedAccounts(opts.filters?.excludedAccounts),
  );
  const maxChars = resolveMaxThreadCharsFromFilters(
    opts.filters?.maxThreadChars,
    process.env.X_MAX_THREAD_CHARS,
  );
  const dropArticles = opts.filters?.dropArticles !== false;
  const byLength = filterThreadsByLength(afterExcludedAccounts.threads, maxChars, {
    dropArticles,
  });

  // Hydrate OP context, then re-drop self-replies missing inReplyToScreenName.
  const hydrated = await doHydrate({
    threads: byLength.threads,
    session,
  });
  const {
    afterSelfReply: afterHydrateSelf,
    afterLinks: afterHydrateLinks,
    afterLanguage: afterHydrateLang,
    afterLength: afterHydrateLen,
  } = filterPostHydrateThreads({
    threads: hydrated.threads,
    preferredLanguage,
    maxChars,
    lengthOptions: { dropArticles },
    dropOutboundLinks,
  });
  const selfReplyFiltered =
    afterSelf.selfReplyFilteredCount +
    afterHydrateSelf.selfReplyFilteredCount;

  track("triaging", "Scout is scoring threads for bait risk…", {
    count: afterHydrateLen.threads.length,
  });
  const triaged = await doTriage({
    agenda,
    threads: afterHydrateLen.threads,
  });
  llmUsage = addTokenUsage(llmUsage, triaged.usage);

  const pipelineCounts: ScoutPipelineCounts = {
    raw: result.rawCount,
    afterDedupe: result.threads.length,
    afterCooldown: filtered.threads.length,
    afterSelfReply: afterSelf.threads.length,
    afterLinks: afterLinks.threads.length,
    afterLength: byLength.threads.length,
    afterHydrateSelfReply: afterHydrateSelf.threads.length,
    afterTriage: triaged.threads.length,
  };
  const funnel = formatPipelineFunnel(pipelineCounts);

  const cooldownWarning = filtered.filteredCount
    ? `Filtered ${filtered.filteredCount} posts from cooled-down authors.`
    : undefined;
  const linkFiltered =
    afterLinks.linkFilteredCount + afterHydrateLinks.linkFilteredCount;
  const linkWarning = linkFiltered
    ? `Dropped ${linkFiltered} posts with outbound links.`
    : undefined;
  const emDashWarning = afterEmDash.emDashFilteredCount
    ? `Dropped ${afterEmDash.emDashFilteredCount} posts with em dashes.`
    : undefined;
  const automatedWarning = afterAutomated.automatedFilteredCount
    ? `Dropped ${afterAutomated.automatedFilteredCount} automated accounts.`
    : undefined;
  const excludedAccountWarning = afterExcludedAccounts.excludedAccountFilteredCount
    ? `Dropped ${afterExcludedAccounts.excludedAccountFilteredCount} excluded accounts.`
    : undefined;
  const articleFiltered =
    byLength.articleFilteredCount + afterHydrateLen.articleFilteredCount;
  const openerFiltered =
    byLength.openerFilteredCount + afterHydrateLen.openerFilteredCount;
  const lengthFiltered = byLength.filteredCount + afterHydrateLen.filteredCount;
  const overChars = lengthFiltered - openerFiltered - articleFiltered;
  const lengthWarning = lengthFiltered
    ? `Dropped ${lengthFiltered} posts (${articleFiltered} articles, ${openerFiltered} thread openers, ${overChars} over ${maxChars} chars).`
    : undefined;

  const done: ScoutEvent = {
    agent: "scout",
    stage: "done",
    message: `Scout found ${triaged.threads.length} threads (${funnel}).`,
    at: new Date().toISOString(),
    threads: triaged.threads,
    queries: result.queries,
    errors: result.errors,
    plannedBy,
    model: planModel,
    triageModel: triaged.model,
    llmProvider,
    llmUsage,
    triageWarning: triaged.warning,
    cooldownFiltered: filtered.filteredCount,
    cooldownAuthors: filtered.filteredAuthors,
    cooldownWarning,
    selfReplyFiltered,
    linkFiltered,
    linkWarning,
    emDashFiltered: afterEmDash.emDashFilteredCount,
    emDashWarning,
    automatedFiltered: afterAutomated.automatedFilteredCount,
    automatedWarning,
    excludedAccountFiltered: afterExcludedAccounts.excludedAccountFilteredCount,
    excludedAccountWarning,
    languageFiltered:
      afterLang.languageFilteredCount + afterHydrateLang.languageFilteredCount,
    lengthFiltered: byLength.filteredCount,
    lengthWarning,
    unhydratedReplyCount: hydrated.unhydratedReplyCount,
    pipelineCounts,
    opencodeTurns: toOpenCodeTurns(events),
  };
  opts.onEvent?.(done);
  if (llmUsage) {
    console.info(
      `[llm] scout_total provider=${llmProvider} prompt_tokens=${llmUsage.prompt_tokens} completion_tokens=${llmUsage.completion_tokens} total_tokens=${llmUsage.total_tokens}`,
    );
  }

  try {
    await doSaveCache({
      savedAt: done.at ?? new Date().toISOString(),
      agenda: agenda || undefined,
      queries: result.queries,
      threads: triaged.threads,
      message: done.message,
      triageWarning: triaged.warning,
      cooldownWarning,
      linkWarning,
      lengthWarning,
      pipelineCounts,
    });
  } catch (err) {
    console.error("Failed to persist last Scout run:", err);
  }

  return { ok: true, event: done };
}
