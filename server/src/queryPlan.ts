/**
 * Agenda → short, high-recall X Latest search queries via the selected LLM.
 */
import {
  addTokenUsage,
  chatCompletions,
  resolveFlashModel,
  type LlmProvider,
  type TokenUsage,
} from "./deepseek.js";

export type QueryPlanResult =
  | {
      ok: true;
      queries: string[];
      model: string;
      provider: LlmProvider;
      raw: string;
      usage?: TokenUsage;
    }
  | { ok: false; error: string; message: string };

export type PlanQueriesOpts = {
  /** Prefer broader, shorter queries (replan / phrase-y repair). */
  broaden?: boolean;
  priorQueries?: string[];
  /** Human-readable yield context for replan. */
  yieldNote?: string;
};

/**
 * Hard single-query cap: wordCount > MAX_QUERY_WORDS → phrase-y.
 * Plans should be mostly 2-word; 3 is allowed sparingly; 4+ is always phrase-y.
 */
export const MAX_QUERY_WORDS = 3;

/** Prefer 2-word plans: average above this → phrase-y. */
export const PREFERRED_AVG_QUERY_WORDS = 2.5;

export const SYSTEM = `You turn an engagement agenda into short X (Twitter) Latest search queries.
Return ONLY valid JSON: {"queries":["..."]} with 2 to 4 queries.

Rules:
- Prefer 2-word queries (highest recall on Latest). 3 words only when needed. Avoid 4+ words.
- Optional operators ok (-is:reply, min_faves, from:) — they do not count against the 2-word preference when the keyword part is short. Do not emit is:reply. Scout wants original posts, not nested leaves.
- At least two queries must contain a content word from the agenda. Match the agenda topic with keywords; do not copy the agenda sentence.
- Mix recall: include 1–2 broad high-recall queries AND 1–2 tighter ones. Do not emit four near-duplicates.
- Do NOT copy the agenda sentence or long multi-word stacks that echo it.
- Prefer Latest-friendly keywords that hit original posts people are already looking at.
- Avoid essay threads, newsletters, long-form dumps, and "thread farm" listicles.
- No essays, no numbering outside JSON, no markdown fences.
- English unless the agenda clearly requires another language.

Good for an agenda about a freight operating system (mostly 2-word, diverse, high recall):
{"queries":["freight software","operating software","just shipped","shipping tech"]}

Bad (agenda echo / too narrow / too long — do NOT do this):
{"queries":["shipping AI tool in public","building AI tool in public","AI tool launch question","shipping AI product help"]}`;

/** Count whitespace-separated tokens in a query string. */
export function queryWordCount(query: string): number {
  return query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/** True when a single query is longer than the hard 3-word cap (4+). */
export function isPhraseyQuery(query: string): boolean {
  return queryWordCount(query) > MAX_QUERY_WORDS;
}

/**
 * Prefer mostly 2-word plans. Triggers broaden repair when:
 * - majority of queries have more than 2 words, or
 * - average word count > 2.5, or
 * - any query is 4+ words (hard phrase-y).
 */
export function isPhraseyPlan(queries: string[]): boolean {
  if (queries.length === 0) return false;
  if (queries.some(isPhraseyQuery)) return true;
  const overTwo = queries.filter((q) => queryWordCount(q) > 2).length;
  if (overTwo >= Math.ceil(queries.length / 2)) return true;
  const avg =
    queries.reduce((sum, q) => sum + queryWordCount(q), 0) / queries.length;
  return avg > PREFERRED_AVG_QUERY_WORDS;
}

const AGENDA_STOPWORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "but",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "its",
  "my",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "this",
  "to",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

function normalizedWords(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Content words that can ground a query in the operator's agenda. */
export function agendaContentWords(agenda: string): Set<string> {
  return new Set(
    normalizedWords(agenda).filter(
      (word) => word.length > 2 && !AGENDA_STOPWORDS.has(word),
    ),
  );
}

function queryKeywordWords(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter(
      (token) =>
        token &&
        !token.includes(":") &&
        token.replace(/^-/, "").toLowerCase() !== "min_faves",
    )
    .flatMap(normalizedWords);
}

/** True when at least two queries contain an agenda content word. */
export function hasAgendaNounQueries(
  queries: string[],
  agenda: string,
): boolean {
  const agendaWords = agendaContentWords(agenda);
  if (agendaWords.size === 0) return true;
  return (
    queries.filter((query) =>
      queryKeywordWords(query).some((word) => agendaWords.has(word)),
    ).length >= 2
  );
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
      "Broaden: prefer shorter high-recall 2-word Latest keywords (3 ok when needed); mix broad + tighter; do not copy the agenda sentence.",
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
  | { ok: true; content: string; model: string; usage?: TokenUsage }
  | { ok: false; error: string; message: string }
> {
  const res = await chatCompletions({
    model,
    purpose: opts?.broaden ? "plan_replan" : "plan",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: buildUserPrompt(agenda, opts) },
    ],
  });
  if (!res.ok) {
    return { ok: false, error: res.error, message: res.message };
  }
  return {
    ok: true,
    content: res.content,
    model: res.model,
    ...(res.usage ? { usage: res.usage } : {}),
  };
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

  const provider: LlmProvider = "deepseek";
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
  let usage = first.usage;

  if (!queries) {
    const repair = await chatCompletions({
      model,
      purpose: "plan_repair",
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
    usage = addTokenUsage(usage, repair.usage);
    if (!queries) {
      return {
        ok: false,
        error: "invalid_plan",
        message: "Model did not return a valid queries JSON array.",
      };
    }
  }

  const phrasey = isPhraseyPlan(queries);
  const missingAgendaNouns = !hasAgendaNounQueries(queries, trimmed);

  // Repair once when the plan is too phrase-y or is not grounded in the agenda.
  if (missingAgendaNouns || (phrasey && !opts?.broaden)) {
    const broaden = await requestPlan(
      trimmed,
      {
        broaden: true,
        priorQueries: queries,
        yieldNote: missingAgendaNouns
          ? "First plan was not grounded in the agenda. Keep 2-word Latest keywords; do not copy the agenda sentence; at least two queries must contain an agenda content noun."
          : "First plan was too phrase-y / agenda-echoing. Broaden to shorter high-recall 2-word keywords; at least two queries must contain an agenda content noun.",
      },
      model,
    );
    if (!broaden.ok && missingAgendaNouns) {
      return {
        ok: false,
        error: broaden.error,
        message: broaden.message,
      };
    }
    if (broaden.ok) {
      const repaired = parseQueryPlanJson(broaden.content);
      usage = addTokenUsage(usage, broaden.usage);
      if (
        missingAgendaNouns &&
        (!repaired || !hasAgendaNounQueries(repaired, trimmed))
      ) {
        return {
          ok: false,
          error: "invalid_plan",
          message:
            "Model did not return a valid plan with two agenda-grounded queries.",
        };
      }
      if (repaired && hasAgendaNounQueries(repaired, trimmed)) {
        queries = repaired;
        raw = broaden.content;
        usedModel = broaden.model;
      }
    }
  }

  if (!hasAgendaNounQueries(queries, trimmed)) {
    return {
      ok: false,
      error: "invalid_plan",
      message:
        "Model did not return a valid plan with two agenda-grounded queries.",
    };
  }

  return {
    ok: true,
    queries,
    model: usedModel,
    provider,
    raw,
    ...(usage ? { usage } : {}),
  };
}
