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
