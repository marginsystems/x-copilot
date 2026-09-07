import { ensureUserTenant } from "./billingStore.js";
import { getPlatformDb } from "./db.js";
import { requireUserId } from "./interactionStore.js";

export type ScoutRejectionCounts = {
  duplicateOrMissingId: number;
  cooldown: number;
  selfReply: number;
  links: number;
  media: number;
  hashtags: number;
  language: number;
  emDash: number;
  profanity: number;
  automatedAccount: number;
  excludedAccount: number;
  views: number;
  articles: number;
  length: number;
  authorDedupe: number;
  authorless: number;
  reserved: number;
  blocked: number;
};

export type ScoutRunRecordInput = {
  id: string;
  userId: string;
  sortieId?: string;
  startedAt: string;
  finishedAt: string;
  queries: string[];
  uniqueCandidateIds: number;
  rejectionCounts: ScoutRejectionCounts;
  usableAdditions: number;
  coolAdditions: number;
  searchCalls: number;
  stopReason: string;
};

export type ScoutRunRecord = ScoutRunRecordInput & {
  tenantId: string;
};

export type RecentScoutRun = Pick<
  ScoutRunRecord,
  | "queries"
  | "uniqueCandidateIds"
  | "usableAdditions"
  | "coolAdditions"
  | "searchCalls"
  | "stopReason"
>;

export function emptyScoutRejectionCounts(): ScoutRejectionCounts {
  return {
    duplicateOrMissingId: 0,
    cooldown: 0,
    selfReply: 0,
    links: 0,
    media: 0,
    hashtags: 0,
    language: 0,
    emDash: 0,
    profanity: 0,
    automatedAccount: 0,
    excludedAccount: 0,
    views: 0,
    articles: 0,
    length: 0,
    authorDedupe: 0,
    authorless: 0,
    reserved: 0,
    blocked: 0,
  };
}

export function addScoutRejectionCounts(
  dest: ScoutRejectionCounts,
  add: Partial<ScoutRejectionCounts>,
): void {
  for (const [key, value] of Object.entries(add) as [
    keyof ScoutRejectionCounts,
    number | undefined,
  ][]) {
    if (typeof value === "number") dest[key] += value;
  }
}

export async function persistScoutRunRecordSafe(
  save: (input: ScoutRunRecordInput) => void | Promise<void>,
  input: ScoutRunRecordInput,
): Promise<void> {
  try {
    await save(input);
  } catch (err) {
    console.error(
      "Failed to persist Scout run record:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

function compactCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function saveScoutRunRecord(input: ScoutRunRecordInput): void {
  const userId = requireUserId(input.userId);
  const tenantId = ensureUserTenant(userId);
  const counts = Object.fromEntries(
    Object.entries(input.rejectionCounts).map(([key, value]) => [
      key,
      compactCount(value),
    ]),
  );
  getPlatformDb()
    .prepare(
      `INSERT INTO scout_runs
         (id, user_id, tenant_id, sortie_id, started_at, finished_at,
          queries_json, unique_candidate_ids, rejection_counts_json,
          usable_additions, cool_additions, search_calls, stop_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      userId,
      tenantId,
      input.sortieId?.trim() || null,
      input.startedAt,
      input.finishedAt,
      JSON.stringify(input.queries.map((query) => query.trim()).filter(Boolean)),
      compactCount(input.uniqueCandidateIds),
      JSON.stringify(counts),
      compactCount(input.usableAdditions),
      compactCount(input.coolAdditions),
      compactCount(input.searchCalls),
      input.stopReason,
    );
}

export function getScoutRunRecord(id: string): ScoutRunRecord | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT id, user_id, tenant_id, sortie_id, started_at, finished_at,
              queries_json, unique_candidate_ids, rejection_counts_json,
              usable_additions, cool_additions, search_calls, stop_reason
         FROM scout_runs WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        user_id: string;
        tenant_id: string;
        sortie_id: string | null;
        started_at: string;
        finished_at: string;
        queries_json: string;
        unique_candidate_ids: number;
        rejection_counts_json: string;
        usable_additions: number;
        cool_additions: number;
        search_calls: number;
        stop_reason: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    sortieId: row.sortie_id ?? undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    queries: JSON.parse(row.queries_json) as string[],
    uniqueCandidateIds: row.unique_candidate_ids,
    rejectionCounts: JSON.parse(
      row.rejection_counts_json,
    ) as ScoutRejectionCounts,
    usableAdditions: row.usable_additions,
    coolAdditions: row.cool_additions,
    searchCalls: row.search_calls,
    stopReason: row.stop_reason,
  };
}

export function listRecentScoutRuns(
  userId: string,
  limit: number,
): RecentScoutRun[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (!userId.trim() || safeLimit === 0) return [];
  const rows = getPlatformDb()
    .prepare(
      `SELECT queries_json, unique_candidate_ids, usable_additions,
              cool_additions, search_calls, stop_reason
         FROM scout_runs
        WHERE user_id = ?
        ORDER BY finished_at DESC, rowid DESC
        LIMIT ?`,
    )
    .all(userId.trim(), safeLimit) as Array<{
    queries_json: string;
    unique_candidate_ids: number;
    usable_additions: number;
    cool_additions: number;
    search_calls: number;
    stop_reason: string;
  }>;
  return rows.flatMap((row) => {
    try {
      const queries: unknown = JSON.parse(row.queries_json);
      if (
        !Array.isArray(queries) ||
        !queries.every(
          (query): query is string => typeof query === "string",
        )
      ) {
        return [];
      }
      return [
        {
          queries,
          uniqueCandidateIds: row.unique_candidate_ids,
          usableAdditions: row.usable_additions,
          coolAdditions: row.cool_additions,
          searchCalls: row.search_calls,
          stopReason: row.stop_reason,
        },
      ];
    } catch {
      return [];
    }
  });
}
