/**
 * Once-per-UTC-day desk analytics note. One DeepSeek pass over the existing
 * analytics summary — same shape as the For You run: skip when already
 * written today, when there are no posts, or when no LLM is configured.
 * Runs from the stats worker tick and only ever soft-fails.
 */
import {
  chatCompletions,
  deepseekConfigured,
  resolveFlashModel,
} from "./deepseek.js";
import { getPlatformDb } from "./db.js";
import { analyticsSummary } from "./ownPostStore.js";
import { extractJsonObject, type ChatFn } from "./voiceLlm.js";

export type AnalyticsInsight = {
  headline: string;
  bullets: string[];
  day: string;
  createdAt: string;
};

export function utcDayKey(nowMs: number = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function mapInsightRow(row: Record<string, unknown>): AnalyticsInsight | null {
  let bullets: string[] = [];
  try {
    const parsed = JSON.parse(String(row.bullets_json ?? "[]"));
    if (Array.isArray(parsed)) {
      bullets = parsed.filter((b): b is string => typeof b === "string");
    }
  } catch {
    return null;
  }
  const headline = String(row.headline ?? "").trim();
  if (!headline || bullets.length < 2) return null;
  return {
    headline,
    bullets,
    day: String(row.day_utc),
    createdAt: String(row.created_at),
  };
}

export function latestAnalyticsInsight(userId: string): AnalyticsInsight | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT day_utc, headline, bullets_json, created_at
       FROM analytics_insights WHERE user_id = ?
       ORDER BY day_utc DESC LIMIT 1`,
    )
    .get(userId) as Record<string, unknown> | undefined;
  return row ? mapInsightRow(row) : null;
}

export function hasInsightToday(
  userId: string,
  nowMs: number = Date.now(),
): boolean {
  const row = getPlatformDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM analytics_insights
       WHERE user_id = ? AND day_utc = ?`,
    )
    .get(userId, utcDayKey(nowMs)) as { n: number };
  return (Number(row.n) || 0) > 0;
}

export function saveAnalyticsInsight(opts: {
  userId: string;
  headline: string;
  bullets: string[];
  model: string;
  nowMs?: number;
}): void {
  const nowMs = opts.nowMs ?? Date.now();
  getPlatformDb()
    .prepare(
      `INSERT INTO analytics_insights
         (user_id, day_utc, headline, bullets_json, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, day_utc) DO NOTHING`,
    )
    .run(
      opts.userId,
      utcDayKey(nowMs),
      opts.headline.trim(),
      JSON.stringify(opts.bullets),
      opts.model,
      new Date(nowMs).toISOString(),
    );
}

/** Every user with at least one watched post — the note reads own_posts only. */
export function listInsightUsers(): string[] {
  const rows = getPlatformDb()
    .prepare(`SELECT DISTINCT user_id AS userId FROM own_posts`)
    .all() as Array<{ userId: string }>;
  return rows.map((r) => r.userId);
}

const SYSTEM = `You write one short daily note about an X operator's own-post analytics. You get their lifetime totals, post-kind mix, a 30-day daily series, and their top posts.
Return ONLY JSON:
{"headline":"one plain sentence, the single most useful observation","bullets":["2 to 4 short observations"]}
Rules:
- Every claim must cite a number that appears in the input (views, likes, posts, a day, a mix count). No invented metrics, no follower counts, no percentages you did not compute from the input.
- Plain language, addressed to the operator ("your replies", "your top post"). No flattery, no advice-column filler, no markdown fences.`;

export function parseInsightJson(
  raw: string,
): { headline: string; bullets: string[] } | null {
  const data = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!data) return null;
  const headline =
    typeof data.headline === "string" ? data.headline.trim() : "";
  const bullets = Array.isArray(data.bullets)
    ? data.bullets
        .filter((b): b is string => typeof b === "string")
        .map((b) => b.trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];
  if (!headline || headline.length > 240 || bullets.length < 2) return null;
  return { headline, bullets };
}

function buildInsightPrompt(
  summary: ReturnType<typeof analyticsSummary>,
): string {
  const activeDays = summary.series.filter((d) => d.posts > 0);
  return [
    "TOTALS",
    JSON.stringify(summary.totals),
    "",
    "KIND_MIX",
    JSON.stringify(summary.kinds),
    "",
    "LAST_30_DAYS (days with posts; the rest of the window is zero)",
    JSON.stringify(activeDays),
    "",
    "TOP_POSTS (by latest views)",
    JSON.stringify(
      summary.top.slice(0, 5).map((p) => ({
        kind: p.kind,
        text: (p.text ?? "").replace(/\s+/g, " ").slice(0, 120),
        postedAt: p.postedAt.slice(0, 10),
        views: p.views,
        likes: p.likes,
        replies: p.replies,
      })),
    ),
  ].join("\n");
}

export async function runAnalyticsInsightForUser(opts: {
  userId: string;
  nowMs?: number;
  chat?: ChatFn;
}): Promise<{ wrote: boolean; reason: string }> {
  const nowMs = opts.nowMs ?? Date.now();
  if (hasInsightToday(opts.userId, nowMs)) {
    return { wrote: false, reason: "already_ran" };
  }
  const summary = analyticsSummary(opts.userId, new Date(nowMs));
  if (summary.totals.posts === 0) {
    return { wrote: false, reason: "thin" };
  }
  if (!opts.chat && !deepseekConfigured()) {
    return { wrote: false, reason: "no_llm" };
  }
  const chat = opts.chat ?? chatCompletions;
  const result = await chat({
    purpose: "analytics_insight",
    model: resolveFlashModel(),
    temperature: 0.3,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: buildInsightPrompt(summary) },
    ],
  });
  if (!result.ok) {
    return { wrote: false, reason: "llm_error" };
  }
  const parsed = parseInsightJson(result.content);
  if (!parsed) {
    return { wrote: false, reason: "parse_error" };
  }
  saveAnalyticsInsight({
    userId: opts.userId,
    headline: parsed.headline,
    bullets: parsed.bullets,
    model: result.model,
    nowMs,
  });
  return { wrote: true, reason: "ok" };
}

export async function runAnalyticsInsights(opts?: {
  nowMs?: number;
  chat?: ChatFn;
  users?: string[];
}): Promise<{ wrote: number; skipped: number }> {
  const users = opts?.users ?? listInsightUsers();
  let wrote = 0;
  let skipped = 0;
  for (const userId of users) {
    try {
      const result = await runAnalyticsInsightForUser({
        userId,
        nowMs: opts?.nowMs,
        chat: opts?.chat,
      });
      if (result.wrote) {
        wrote += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      skipped += 1;
      console.warn(`[insight] soft-fail user=${userId}:`, err);
    }
  }
  return { wrote, skipped };
}
