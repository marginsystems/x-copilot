import type { PlanQueriesOpts } from "./queryPlan.js";
import { listRecentScoutRuns } from "./scoutRunStore.js";

const HISTORY_RUN_LIMIT = 6;
const PRIOR_QUERY_LIMIT = 24;

function uniqueQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const query of queries) {
    const trimmed = query.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
    if (unique.length === PRIOR_QUERY_LIMIT) break;
  }
  return unique;
}

export function scoutPlanHistoryOpts(
  userId: string,
): PlanQueriesOpts | undefined {
  const trimmedUserId = userId.trim();
  if (!trimmedUserId) return undefined;
  const runs = listRecentScoutRuns(trimmedUserId, HISTORY_RUN_LIMIT);
  if (runs.length === 0) return undefined;
  return {
    priorQueries: uniqueQueries(runs.flatMap((run) => run.queries)),
    yieldNote: runs
      .map(
        (run) =>
          `unique=${run.uniqueCandidateIds} usable=${run.usableAdditions} cool=${run.coolAdditions} calls=${run.searchCalls} queries=${JSON.stringify(run.queries)}`,
      )
      .join("; "),
  };
}

export function mergeScoutPlanHistoryOpts(
  userId: string,
  opts: PlanQueriesOpts,
): PlanQueriesOpts {
  const history = scoutPlanHistoryOpts(userId);
  if (!history) return opts;
  return {
    ...opts,
    priorQueries: uniqueQueries([
      ...(opts.priorQueries ?? []),
      ...(history.priorQueries ?? []),
    ]),
    yieldNote: [history.yieldNote, opts.yieldNote].filter(Boolean).join("; "),
  };
}
