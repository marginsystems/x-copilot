import type Database from "better-sqlite3";
import { getPlatformDb } from "../db.js";
import { isRecord } from "../platform/unknownValue.js";
import type { TweetMetrics } from "./tweetLookup.js";

export type LiveMetricsRowStatus = "ok" | "absent" | "failed";

export type LiveMetricsRow = {
  tweetId: string;
  status: LiveMetricsRowStatus;
  metrics: TweetMetrics | null;
  fetchedAt: number;
};

export const LIVE_METRICS_TTL_MS = 15 * 60 * 1000;
export const LIVE_METRICS_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;
export const LIVE_METRICS_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const LIVE_METRICS_STORE_RETRY_MS = 60 * 1000;

const METRIC_KEYS = ["views", "likes", "replies", "retweets", "bookmarks"] as const;

type Statements = {
  read: Database.Statement;
  upsert: Database.Statement;
  prune: Database.Statement;
};

const statementsByDb = new WeakMap<Database.Database, Statements>();
let unavailableUntil = 0;
let lastPrunedAt = 0;

function statements(): Statements {
  const db = getPlatformDb();
  const cached = statementsByDb.get(db);
  if (cached) return cached;
  const created: Statements = {
    read: db.prepare(
      `SELECT tweet_id, status, metrics_json, fetched_at FROM live_tweet_metrics
       WHERE tweet_id IN (SELECT value FROM json_each(?)) AND fetched_at > ?`,
    ),
    upsert: db.prepare(
      `INSERT INTO live_tweet_metrics (tweet_id, status, metrics_json, fetched_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (tweet_id) DO UPDATE SET
         status = excluded.status,
         metrics_json = excluded.metrics_json,
         fetched_at = excluded.fetched_at
       WHERE excluded.status <> 'failed'
         OR live_tweet_metrics.status = 'failed'
         OR excluded.fetched_at - live_tweet_metrics.fetched_at >= ?`,
    ),
    prune: db.prepare(`DELETE FROM live_tweet_metrics WHERE fetched_at < ?`),
  };
  statementsByDb.set(db, created);
  return created;
}

function withStore<T>(fallback: T, run: (s: Statements) => T): T {
  const now = Date.now();
  if (now < unavailableUntil) return fallback;
  try {
    return run(statements());
  } catch (err) {
    unavailableUntil = now + LIVE_METRICS_STORE_RETRY_MS;
    console.warn(
      `[live-metrics] store unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
    return fallback;
  }
}

function isStatus(value: unknown): value is LiveMetricsRowStatus {
  return value === "ok" || value === "absent" || value === "failed";
}

function parseMetricsJson(raw: unknown): TweetMetrics | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const out: TweetMetrics = {};
  for (const key of METRIC_KEYS) {
    const value = parsed[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function toRow(raw: unknown): LiveMetricsRow | null {
  if (!isRecord(raw)) return null;
  const tweetId = raw.tweet_id;
  const status = raw.status;
  const fetchedAt = Number(raw.fetched_at);
  if (typeof tweetId !== "string" || !isStatus(status) || !Number.isFinite(fetchedAt)) {
    return null;
  }
  const metrics = status === "ok" ? parseMetricsJson(raw.metrics_json) : null;
  if (status === "ok" && !metrics) return null;
  return { tweetId, status, metrics, fetchedAt };
}

export function readLiveMetricsRows(
  tweetIds: readonly string[],
  fetchedAfter: number,
): LiveMetricsRow[] {
  if (!tweetIds.length) return [];
  return withStore<LiveMetricsRow[]>([], (s) =>
    s.read
      .all(JSON.stringify(tweetIds), fetchedAfter)
      .map(toRow)
      .filter((row): row is LiveMetricsRow => row !== null),
  );
}

export function pruneLiveMetricsRows(olderThan: number): number {
  return withStore(0, (s) => s.prune.run(olderThan).changes);
}

export function writeLiveMetricsRows(rows: readonly LiveMetricsRow[]): void {
  if (!rows.length) return;
  withStore(undefined, (s) => {
    const db = getPlatformDb();
    db.transaction(() => {
      for (const row of rows) {
        s.upsert.run(
          row.tweetId,
          row.status,
          row.metrics ? JSON.stringify(row.metrics) : null,
          row.fetchedAt,
          LIVE_METRICS_TTL_MS,
        );
      }
    })();
  });
  const now = Date.now();
  if (now - lastPrunedAt < LIVE_METRICS_PRUNE_INTERVAL_MS) return;
  lastPrunedAt = now;
  pruneLiveMetricsRows(now - LIVE_METRICS_ROW_RETENTION_MS);
}

export function clearLiveMetricsRowsForTests(): void {
  unavailableUntil = 0;
  lastPrunedAt = 0;
  withStore(undefined, () => {
    getPlatformDb().prepare(`DELETE FROM live_tweet_metrics`).run();
  });
}

export function resetLiveMetricsStoreStateForTests(): void {
  unavailableUntil = 0;
  lastPrunedAt = 0;
}
