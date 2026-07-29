/**
 * Agenda → short, high-recall X Latest search queries via DeepSeek.
 */
import { chatCompletions, resolveFlashModel } from "./deepseek.js";

export type QueryPlanResult =
  | { ok: true; queries: string[]; model: string; raw: string }
  | { ok: false; error: string; message: string };

export type PlanQueriesOpts = {
  /** Prefer broader, shorter queries (replan / phrase-y repair). */
  broaden?: boolean;
  priorQueries?: string[];
  /** Human-readable yield context for replan. */
  yieldNote?: string;
};

/** Soft cap: > this many whitespace tokens → phrase-y / low-recall. */
export const MAX_QUERY_WORDS = 4;

export const SYSTEM = `You turn an engagement agenda into short X (Twitter) Latest search queries.
Return ONLY valid JSON: {"queries":["..."]} with 2 to 4 queries.

Rules:
- Each query is 2–4 words (keyword/search string). Optional operators ok (filter:replies, min_faves, from:).
- Mix recall: include 1–2 broad high-recall queries AND 1–2 tighter ones. Do not emit four near-duplicates.
- Do NOT copy the agenda sentence or long multi-word stacks that echo it.
- Prefer Latest-friendly keywords that hit many recent short conversational posts and genuine questions.
- Avoid essay threads, newsletters, long-form dumps, and "thread farm" listicles.
- No essays, no numbering outside JSON, no markdown fences.
- English unless the agenda clearly requires another language.

Good (short, diverse, high recall):
{"queries":["building in public AI","shipped my AI","AI builders help","how do I ship"]}

Bad (agenda echo / too narrow — do NOT do this):
{"queries":["shipping AI tool in public","building AI tool in public","AI tool launch question","shipping AI product help"]}`;

/** Count whitespace-separated tokens in a query string. */
export function queryWordCount(query: string): number {
  return query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/** True when a single query is longer than the soft 2–4 word target. */
export function isPhraseyQuery(query: string): boolean {
  return queryWordCount(query) > MAX_QUERY_WORDS;
}

/**
 * Light check: majority of queries are phrase-y, or average word count > 4.
 * Used to trigger one broaden repair — not a hard reject of valid JSON.
 */
export function isPhraseyPlan(queries: string[]): boolean {
  if (queries.length === 0) return false;
  const phrasey = queries.filter(isPhraseyQuery).length;
  if (phrasey >= Math.ceil(queries.length / 2)) return true;
  const avg =
    queries.reduce((sum, q) => sum + queryWordCount(q), 0) / queries.length;
  return avg > MAX_QUERY_WORDS;
}

/** Strip markdown fences and parse {"queries": string[]} (exported for tests). */
export function parseQueryPlanJson(raw: string): string[] | null {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as {
      queries?: unknown;
    };
    return validateQueries(data.queries);
  } catch {
    return null;
  }
}

export function validateQueries(queries: unknown): string[] | null {
  if (!Array.isArray(queries)) return null;
  const cleaned = [
    ...new Set(
      queries
        .filter((q): q is string => typeof q === "string")
        .map((q) => q.trim())
        .filter((q) => q.length > 0 && q.length <= 200),
    ),
  ].slice(0, 4);
  if (cleaned.length < 2) return null;
  return cleaned;
}

function buildUserPrompt(agenda: string, opts?: PlanQueriesOpts): string {
  const parts = [`Agenda: ${JSON.stringify(agenda)}`];
  if (opts?.priorQueries?.length) {
    parts.push(`Prior queries (low yield): ${JSON.stringify(opts.priorQueries)}`);
  }
  if (opts?.yieldNote?.trim()) {
    parts.push(`Yield note: ${opts.yieldNote.trim()}`);
  }
  if (opts?.broaden || opts?.yieldNote?.trim()) {
    parts.push(
      "Broaden: prefer shorter high-recall 2–4 word Latest keywords; mix broad + tighter; do not copy the agenda sentence.",
    );
  }
  parts.push("Respond with JSON only.");
  return parts.join("\n\n");
}

async function requestPlan(
  agenda: string,
  opts: PlanQueriesOpts | undefined,
  model: string,
): Promise<
  | { ok: true; content: string; model: string }
  | { ok: false; error: string; message: string }
> {
  const res = await chatCompletions({
    model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: buildUserPrompt(agenda, opts) },
    ],
  });
  if (!res.ok) {
    return { ok: false, error: res.error, message: res.message };
  }
  return { ok: true, content: res.content, model: res.model };
}

export async function planQueriesFromAgenda(
  agenda: string,
  opts?: PlanQueriesOpts,
): Promise<QueryPlanResult> {
  const trimmed = agenda.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "empty_agenda",
      message: "Agenda is empty.",
    };
  }
  if (trimmed.length > 5000) {
    return {
      ok: false,
      error: "agenda_too_long",
      message: "Agenda exceeds 5000 characters.",
    };
  }

  const model = resolveFlashModel();
  const first = await requestPlan(trimmed, opts, model);
  if (!first.ok) {
    return {
      ok: false,
      error: first.error,
      message: first.message,
    };
  }

  let queries = parseQueryPlanJson(first.content);
  let raw = first.content;
  let usedModel = first.model;

  if (!queries) {
    const repair = await chatCompletions({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: buildUserPrompt(trimmed, opts) },
        { role: "assistant", content: first.content },
        {
          role: "user",
          content:
            'Your previous reply was not valid JSON of the form {"queries":["q1","q2"]}. Reply again with ONLY that JSON.',
        },
      ],
    });

    if (!repair.ok) {
      return {
        ok: false,
        error: repair.error,
        message: repair.message,
      };
    }

    queries = parseQueryPlanJson(repair.content);
    raw = repair.content;
    usedModel = repair.model;
    if (!queries) {
      return {
        ok: false,
        error: "invalid_plan",
        message: "DeepSeek did not return a valid queries JSON array.",
      };
    }
  }

  // One broaden repair if the plan is still too phrase-y (skip if already broadening).
  if (isPhraseyPlan(queries) && !opts?.broaden) {
    const broaden = await requestPlan(
      trimmed,
      {
        broaden: true,
        priorQueries: queries,
        yieldNote:
          "First plan was too phrase-y / agenda-echoing. Broaden to shorter high-recall keywords.",
      },
      model,
    );
    if (broaden.ok) {
      const repaired = parseQueryPlanJson(broaden.content);
      if (repaired) {
        queries = repaired;
        raw = broaden.content;
        usedModel = broaden.model;
      }
    }
  }

  return { ok: true, queries, model: usedModel, raw };
}
