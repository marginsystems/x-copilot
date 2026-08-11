/**
 * Scout search runner — same pipeline as /api/search with stage callbacks.
 */
import {
  filterThreadsByCooldown,
  getAuthorKeysForScoutFilter,
} from "./interactionStore.js";
import { getBlockedConversationIds } from "./dismissalStore.js";
import { toOpenCodeTurns, type ScoutStageEvent } from "./opencodeAdapter.js";
import { planQueriesFromAgenda } from "./queryPlan.js";
import { saveScoutCache } from "./scoutCache.js";
import {
  filterAutomatedAccounts,
  filterByLanguage,
  filterEmDashes,
  filterOutboundLinks,
  filterSelfReplies,
  filterThreadsByLength,
  normalizePreferredLanguageCode,
  resolveMaxThreadCharsFromFilters,
} from "./threadFilters.js";
import { hydrateReplyParents } from "./tweetLookup.js";
import { triageThreads } from "./threadTriage.js";
import { searchMany, type ThreadCard } from "./xSearch.js";
import { getSessionFromEnv, type SessionCreds } from "./xSession.js";

export type ScoutStageId =
  | "planning"
  | "searching"
  | "filtering"
  | "triaging"
  | "done"
  | "error";

export type ScoutPipelineCounts = {
  raw: number;
  afterDedupe: number;
  afterCooldown: number;
  afterSelfReply: number;
  afterLinks: number;
  afterLength: number;
  afterHydrateSelfReply: number;
  afterTriage: number;
};

export type ScoutEvent = ScoutStageEvent & {
  stage: ScoutStageId;
  threads?: ThreadCard[];
  queries?: string[];
  errors?: Array<{ query: string; message: string }>;
  plannedBy?: "client" | "deepseek";
  model?: string;
  triageModel?: string;
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

export type ScoutFilters = {
  maxThreadChars?: number;
  dropArticles?: boolean;
  /** When true (default), hard-drop posts containing an em dash (U+2014). */
  dropEmDashes?: boolean;
  /** When true (default), hard-drop authors with X's Automated badge. */
  dropAutomatedAccounts?: boolean;
  /** When true (default), never curate authors from interaction history. */
  dedupeAccounts?: boolean;
  /** ISO 639-1; default English when omitted. */
  preferredLanguage?: string;
  /**
   * Post-triage Curated excludes (flags + normalized intent).
   * Omit → server default (`supportive_encouragement`, `political`); `[]` → no tag excludes.
   */
  excludedTags?: string[];
};

export async function runScoutSearch(opts: {
  agenda?: string;
  queries?: string[];
  filters?: ScoutFilters;
  session?: SessionCreds;
  onEvent?: (event: ScoutEvent) => void;
}): Promise<ScoutRunResult> {
  const session = opts.session ?? getSessionFromEnv();
  if (!session.configured) {
    return {
      ok: false,
      status: 401,
      error: "missing_credentials",
      message: "Set X_AUTH_TOKEN and X_CT0 in .env.",
    };
  }

  const events: ScoutStageEvent[] = [];
  const track = (stage: ScoutStageId, message: string, detail?: unknown) => {
    const ev = emit(opts.onEvent, stage, message, detail);
    events.push(ev);
    return ev;
  };

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
    plannedBy = "deepseek";
    planModel = plan.model;
  } else {
    track("planning", "Scout is using client-provided queries…", { queries });
  }

  const result = await searchMany(queries, {
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
  const cooled = await getAuthorKeysForScoutFilter({
    dedupeAccounts: opts.filters?.dedupeAccounts,
  });
  const blockedConversations = await getBlockedConversationIds();
  const filtered = filterThreadsByCooldown(
    result.threads,
    cooled,
    blockedConversations,
  );
  const afterSelf = filterSelfReplies(filtered.threads);
  const afterLinks = filterOutboundLinks(afterSelf.threads);
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
  const maxChars = resolveMaxThreadCharsFromFilters(
    opts.filters?.maxThreadChars,
    process.env.X_MAX_THREAD_CHARS,
  );
  const dropArticles = opts.filters?.dropArticles !== false;
  const byLength = filterThreadsByLength(afterAutomated.threads, maxChars, {
    dropArticles,
  });

  // Hydrate OP context, then re-drop self-replies missing inReplyToScreenName.
  const hydrated = await hydrateReplyParents({
    threads: byLength.threads,
    session,
  });
  const afterHydrateSelf = filterSelfReplies(hydrated.threads);
  // Re-check language now that reply-parent OP text is available (#121).
  const afterHydrateLang = filterByLanguage(
    afterHydrateSelf.threads,
    preferredLanguage,
  );
  const selfReplyFiltered =
    afterSelf.selfReplyFilteredCount +
    afterHydrateSelf.selfReplyFilteredCount;

  track("triaging", "Scout is scoring threads for bait risk…", {
    count: afterHydrateLang.threads.length,
  });
  const triaged = await triageThreads({
    agenda,
    threads: afterHydrateLang.threads,
  });

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
  const linkWarning = afterLinks.linkFilteredCount
    ? `Dropped ${afterLinks.linkFilteredCount} posts with outbound links.`
    : undefined;
  const emDashWarning = afterEmDash.emDashFilteredCount
    ? `Dropped ${afterEmDash.emDashFilteredCount} posts with em dashes.`
    : undefined;
  const automatedWarning = afterAutomated.automatedFilteredCount
    ? `Dropped ${afterAutomated.automatedFilteredCount} automated accounts.`
    : undefined;
  const overChars =
    byLength.filteredCount -
    byLength.openerFilteredCount -
    byLength.articleFilteredCount;
  const lengthWarning = byLength.filteredCount
    ? `Dropped ${byLength.filteredCount} posts (${byLength.articleFilteredCount} articles, ${byLength.openerFilteredCount} thread openers, ${overChars} over ${maxChars} chars).`
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
    triageWarning: triaged.warning,
    cooldownFiltered: filtered.filteredCount,
    cooldownAuthors: filtered.filteredAuthors,
    cooldownWarning,
    selfReplyFiltered,
    linkFiltered: afterLinks.linkFilteredCount,
    linkWarning,
    emDashFiltered: afterEmDash.emDashFilteredCount,
    emDashWarning,
    automatedFiltered: afterAutomated.automatedFilteredCount,
    automatedWarning,
    languageFiltered:
      afterLang.languageFilteredCount + afterHydrateLang.languageFilteredCount,
    lengthFiltered: byLength.filteredCount,
    lengthWarning,
    unhydratedReplyCount: hydrated.unhydratedReplyCount,
    pipelineCounts,
    opencodeTurns: toOpenCodeTurns(events),
  };
  opts.onEvent?.(done);

  try {
    await saveScoutCache({
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
