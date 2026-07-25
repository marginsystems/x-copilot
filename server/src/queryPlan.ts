/**
 * Agenda → short X search queries via DeepSeek V4 Flash (single call).
 */
import { chatCompletions, resolveFlashModel } from "./deepseek.js";

export type QueryPlanResult =
  | { ok: true; queries: string[]; model: string; raw: string }
  | { ok: false; error: string; message: string };

const SYSTEM = `You turn an engagement agenda into short X (Twitter) search queries.
Return ONLY valid JSON: {"queries":["..."]} with 2 to 4 queries.
Rules:
- Each query is a short keyword/search string (optionally with operators like from:, filter:replies, min_faves).
- No essays, no numbering outside JSON, no markdown fences.
- Prefer Latest-friendly topical queries that surface conversational posts and questions.
- English unless the agenda clearly requires another language.`;

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

export async function planQueriesFromAgenda(
  agenda: string,
): Promise<QueryPlanResult> {
  const trimmed = agenda.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "empty_agenda",
      message: "Agenda is empty.",
    };
  }

  const model = resolveFlashModel();
  const first = await chatCompletions({
    model,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Agenda:\n${trimmed}\n\nRespond with JSON only.`,
      },
    ],
  });

  if (!first.ok) {
    return {
      ok: false,
      error: first.error,
      message: first.message,
    };
  }

  let queries = parseQueryPlanJson(first.content);
  if (queries) {
    return { ok: true, queries, model: first.model, raw: first.content };
  }

  const repair = await chatCompletions({
    model,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Agenda:\n${trimmed}\n\nRespond with JSON only.`,
      },
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
  if (!queries) {
    return {
      ok: false,
      error: "invalid_plan",
      message: "DeepSeek did not return a valid queries JSON array.",
    };
  }

  return { ok: true, queries, model: repair.model, raw: repair.content };
}
