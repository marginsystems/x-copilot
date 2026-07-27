/**
 * Scout search runner — same pipeline as /api/search with stage callbacks.
 */
import {
  filterThreadsByCooldown,
  getCooledAuthorKeys,
} from "./interactionStore.js";
import { toOpenCodeTurns, type ScoutStageEvent } from "./opencodeAdapter.js";
import { planQueriesFromAgenda } from "./queryPlan.js";
import {
  filterThreadsByLength,
  resolveMaxThreadChars,
} from "./threadFilters.js";
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
  lengthFiltered?: number;
  lengthWarning?: string;
  opencodeTurns?: ReturnType<typeof toOpenCodeTurns>;
};

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

export async function runScoutSearch(opts: {
  agenda?: string;
  queries?: string[];
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
    onQuery: (index, qTotal, query) => {
      track(
        "searching",
        `Scout is searching X (query ${index}/${qTotal})…`,
        { query, index, total: qTotal },
      );
    },
  });

  track("filtering", "Scout is applying cooldown + length filters…");
  const cooled = await getCooledAuthorKeys();
  const filtered = filterThreadsByCooldown(result.threads, cooled);
  const maxChars = resolveMaxThreadChars(process.env.X_MAX_THREAD_CHARS);
  const byLength = filterThreadsByLength(filtered.threads, maxChars);

  track("triaging", "Scout is scoring threads for bait risk…", {
    count: byLength.threads.length,
  });
  const triaged = await triageThreads({
    agenda,
    threads: byLength.threads,
  });

  const cooldownWarning = filtered.filteredCount
    ? `Filtered ${filtered.filteredCount} posts from cooled-down authors.`
    : undefined;
  const lengthWarning = byLength.filteredCount
    ? `Dropped ${byLength.filteredCount} posts (${byLength.openerFilteredCount} thread openers, ${byLength.filteredCount - byLength.openerFilteredCount} over ${maxChars} chars).`
    : undefined;

  const done: ScoutEvent = {
    agent: "scout",
    stage: "done",
    message: `Scout found ${triaged.threads.length} threads.`,
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
    lengthFiltered: byLength.filteredCount,
    lengthWarning,
    opencodeTurns: toOpenCodeTurns(events),
  };
  opts.onEvent?.(done);
  return { ok: true, event: done };
}
