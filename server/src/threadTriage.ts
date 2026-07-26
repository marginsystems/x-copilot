/**
 * Post-search thread triage via DeepSeek (one batched call).
 * Adds a one-line summary + bait risk so we do not draft replies into engagement bait.
 */
import { chatCompletions, resolveFlashModel } from "./deepseek.js";
import type { ThreadCard } from "./xSearch.js";

export type Engage = "skip" | "consider" | "priority";

export type TriageItem = {
  id: string;
  summary?: string;
  baitScore?: number;
  flags?: string[];
  intent?: string;
  engage?: Engage;
  reason?: string;
};

export type TriageResult = {
  threads: ThreadCard[];
  warning?: string;
  model?: string;
};

/** Max threads sent to the model in one batched call. */
export const MAX_TRIAGE_THREADS = 20;

const ENGAGE_VALUES: readonly Engage[] = ["skip", "consider", "priority"];
const MAX_TEXT_CHARS = 500;
const MAX_FIELD_CHARS = 300;
const MAX_FLAGS = 6;

const SYSTEM = `You triage X (Twitter) posts for a human who replies manually. For each post return an intent read and a bait risk.

Return ONLY valid JSON: {"items":[{"id":"...","summary":"...","baitScore":0,"flags":["..."],"intent":"...","engage":"skip","reason":"..."}]}
One item per input post, same "id" values, no extra keys, no markdown fences.

Fields:
- summary: ONE sentence on what the post is about and why it was likely posted. Not a paraphrase of the whole text.
- baitScore: integer 0-100. HIGHER = more engagement bait / less worth replying to.
- flags: short snake_case tags from: engagement_bait, generic_question, promo, github_plug, low_substance, thread_farm, giveaway, rage_bait, on_agenda, genuine_question.
- intent: 2-4 words, e.g. "engagement farming", "genuine help request", "product promo".
- engage: "skip" | "consider" | "priority".
- reason: one short clause explaining the score.

Bait patterns (score high, 70-100):
- Generic questions with no personal context posted to farm replies ("What's your favorite AI tool?", "Drop your stack below").
- Reply-gated promos ("comment 'AI' and I'll DM the link"), giveaways, follow-for-follow.
- Posts whose main payload is a GitHub/product link with hollow framing ("I built this, thoughts?" with no detail).
- Listicle/thread farming, rage bait, engagement pods.

Low bait (0-30): specific technical questions with real context, concrete build reports with detail, posts that clearly match the agenda.

Agenda awareness: a question is NOT bait just because it is a question. If it is genuine, specific, and on-agenda, score it low and prefer engage "priority" or "consider". Use "skip" when baitScore is high or the post is off-agenda noise.`;

function clampScore(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function cleanText(value: unknown, max = MAX_FIELD_CHARS): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function cleanFlags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const flags = [
    ...new Set(
      value
        .filter((f): f is string => typeof f === "string")
        .map((f) => f.trim().toLowerCase().replace(/\s+/g, "_"))
        .filter((f) => f.length > 0 && f.length <= 40),
    ),
  ].slice(0, MAX_FLAGS);
  return flags.length ? flags : undefined;
}

function cleanEngage(value: unknown): Engage | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return ENGAGE_VALUES.find((v) => v === normalized);
}

/** Strip fences and parse {"items":[...]} into validated triage items (exported for tests). */
export function parseTriageJson(raw: string): TriageItem[] | null {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  let data: { items?: unknown };
  try {
    data = JSON.parse(text.slice(start, end + 1)) as { items?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(data.items)) return null;

  const seen = new Set<string>();
  const items: TriageItem[] = [];
  for (const entry of data.items) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const item: TriageItem = { id };
    const summary = cleanText(row.summary);
    if (summary) item.summary = summary;
    const baitScore = clampScore(row.baitScore);
    if (baitScore !== undefined) item.baitScore = baitScore;
    const flags = cleanFlags(row.flags);
    if (flags) item.flags = flags;
    const intent = cleanText(row.intent, 60);
    if (intent) item.intent = intent;
    const engage = cleanEngage(row.engage);
    if (engage) item.engage = engage;
    const reason = cleanText(row.reason);
    if (reason) item.reason = reason;
    items.push(item);
  }

  return items;
}

/** Merge triage items onto threads by id; unknown ids are ignored (exported for tests). */
export function mergeTriage(
  threads: ThreadCard[],
  items: TriageItem[],
): ThreadCard[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return threads.map((thread) => {
    const item = byId.get(thread.id);
    if (!item) return thread;
    const merged: ThreadCard = { ...thread };
    if (item.summary) merged.summary = item.summary;
    if (item.baitScore !== undefined) {
      merged.baitScore = item.baitScore;
      merged.score = item.baitScore;
    }
    if (item.flags) merged.flags = item.flags;
    if (item.intent) merged.intent = item.intent;
    if (item.engage) merged.engage = item.engage;
    if (item.reason) merged.reason = item.reason;
    return merged;
  });
}

function buildUserMessage(agenda: string, threads: ThreadCard[]): string {
  const compact = threads.map((t) => ({
    id: t.id,
    author: t.author,
    text: t.text.slice(0, MAX_TEXT_CHARS),
  }));
  const agendaLine = agenda.trim()
    ? `Agenda: ${JSON.stringify(agenda.trim())}`
    : "Agenda: (none provided — judge bait risk on the post alone)";
  return `${agendaLine}\n\nPosts:\n${JSON.stringify(compact)}\n\nRespond with JSON only, one item per post.`;
}

/**
 * Triage threads with one batched DeepSeek call.
 * Never throws: on any failure the original threads come back with a warning.
 */
export async function triageThreads(opts: {
  agenda?: string;
  threads: ThreadCard[];
  apiKey?: string;
}): Promise<TriageResult> {
  const threads = opts.threads;
  if (!threads.length) return { threads };

  const apiKey = (opts.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "").trim();
  if (!apiKey) {
    return {
      threads,
      warning: "Triage skipped — set DEEPSEEK_API_KEY for summaries and bait scores.",
    };
  }

  const batch = threads.slice(0, MAX_TRIAGE_THREADS);
  const overflow = threads.length - batch.length;
  const model = resolveFlashModel();
  const userMessage = buildUserMessage(opts.agenda ?? "", batch);

  const first = await chatCompletions({
    model,
    apiKey,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userMessage },
    ],
  });
  if (!first.ok) {
    return { threads, warning: `Triage failed — ${first.message}` };
  }

  let items = parseTriageJson(first.content);
  let used = first;

  if (!items?.length) {
    const repair = await chatCompletions({
      model,
      apiKey,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userMessage },
        { role: "assistant", content: first.content },
        {
          role: "user",
          content:
            'Your previous reply was not valid JSON of the form {"items":[{"id":"...","summary":"...","baitScore":0,"flags":[],"intent":"...","engage":"consider","reason":"..."}]}. Reply again with ONLY that JSON.',
        },
      ],
    });
    if (!repair.ok) {
      return { threads, warning: `Triage failed — ${repair.message}` };
    }
    items = parseTriageJson(repair.content);
    used = repair;
  }

  if (!items?.length) {
    return { threads, warning: "Triage failed — DeepSeek did not return valid JSON." };
  }

  return {
    threads: mergeTriage(threads, items),
    model: used.model,
    warning: overflow > 0 ? `Triaged first ${batch.length} of ${threads.length} threads.` : undefined,
  };
}
