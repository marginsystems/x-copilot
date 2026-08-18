/**
 * DeepSeek v4-flash voice work: style card, one reply draft, and the
 * edit-verify sign-off. Prompts see the user's own public posts only.
 */
import {
  chatCompletions,
  resolveFlashModel,
  type ChatCompletionResult,
  type ChatMessage,
} from "./deepseek.js";
import {
  draftHasAiTropes,
  sanitizeSuggestedDraft,
} from "./voiceDraft.js";
import type { VoiceReplyRow } from "./voiceStore.js";

export type ChatFn = (opts: {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  purpose?: string;
}) => Promise<ChatCompletionResult>;

export type VoiceCard = {
  tone: string;
  typicalLength: string;
  habits: string[];
  neverDo: string[];
  examples: string[];
};

/** Strip markdown fences and parse the outermost JSON object. */
export function extractJsonObject(raw: string): unknown | null {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1]!.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max);
}

export function parseVoiceCardJson(raw: string): VoiceCard | null {
  const data = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!data) return null;
  const tone = typeof data.tone === "string" ? data.tone.trim() : "";
  const typicalLength =
    typeof data.typicalLength === "string"
      ? data.typicalLength.trim()
      : typeof data.typical_length === "string"
        ? data.typical_length.trim()
        : "";
  const habits = stringList(data.habits, 8);
  const neverDo = stringList(data.neverDo ?? data.never_do, 8);
  const examples = stringList(data.examples, 12);
  if (!tone || examples.length < 3) return null;
  return { tone, typicalLength, habits, neverDo, examples };
}

const CARD_SYSTEM = `You are a writing-voice analyst. You get one X user's own public posts (originals and replies). Describe how they write so a drafting assistant can imitate them.
Return ONLY a JSON object:
{"tone":"one or two sentences, plain words","typicalLength":"e.g. one short sentence, 8-20 words","habits":["3-8 concrete habits: openers, punctuation, slang, emoji use"],"neverDo":["2-6 things they never do"],"examples":["8-12 verbatim posts from the input that best show the voice"]}
Rules: examples must be copied verbatim from the input posts. Plain language, no flattery, no markdown fences.`;

export async function generateVoiceCard(opts: {
  handle: string;
  replies: VoiceReplyRow[];
  chat?: ChatFn;
}): Promise<
  | { ok: true; card: VoiceCard; cardJson: string; model: string }
  | { ok: false; error: string; message: string }
> {
  const chat = opts.chat ?? chatCompletions;
  const sample = opts.replies.slice(0, 120);
  const user = [
    `Handle: @${opts.handle}`,
    `Their posts, newest first (${sample.length}):`,
    ...sample.map((r, i) => `${i + 1}. ${r.text.replace(/\s+/g, " ").trim()}`),
  ].join("\n");
  const result = await chat({
    messages: [
      { role: "system", content: CARD_SYSTEM },
      { role: "user", content: user },
    ],
    model: resolveFlashModel(),
    temperature: 0.4,
    purpose: "voice_card",
  });
  if (!result.ok) {
    return { ok: false, error: result.error, message: result.message };
  }
  const card = parseVoiceCardJson(result.content);
  if (!card) {
    return {
      ok: false,
      error: "card_parse_failed",
      message: "Voice model returned an unreadable card. Try refresh.",
    };
  }
  return {
    ok: true,
    card,
    cardJson: JSON.stringify(card),
    model: result.model,
  };
}

const SUGGEST_SYSTEM = `You draft ONE reply to an X post in this specific human's voice. The voice card and example posts are the source of truth. Imitate them, not a generic assistant.
Rules:
- Match their tone, typical length, and habits. Respect every neverDo. Steal cadence from the examples.
- One reply only. No hashtags unless they habitually use them. No @-mentions.
- Under 260 characters. Plain text only. No quotes around it, no markdown, no explanation.
- Add something real (a take, a fact, a question). Never "great post!" filler.
- Never use an em dash. Use a period, comma, or "and".
- Never write "if X, then Y" formulas.
- Never write "this isn't X, it's Y" or "it's not X, it's Y" contrast templates.`;

const SLOP_RETRY = `Rewrite that reply. Stay in the voice card. No em dashes. No "if X, then Y". No "this isn't X, it's Y" / "it's not X, it's Y".`;

/** Strip wrapping quotes/fences the model sometimes adds around a draft. */
export function cleanDraft(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1]!.trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("“") && text.endsWith("”"))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text.replace(/\s+\n/g, "\n").slice(0, 280).trim();
}

export async function suggestReply(opts: {
  cardJson: string;
  thread: { author: string; text: string; opAuthor?: string; opText?: string };
  agenda?: string;
  /** Operator-picked side when the post assumes an argument. */
  stance?: string;
  chat?: ChatFn;
}): Promise<
  | { ok: true; draft: string; model: string }
  | { ok: false; error: string; message: string }
> {
  const chat = opts.chat ?? chatCompletions;
  const parts = [
    `Voice card JSON:\n${opts.cardJson}`,
    opts.agenda?.trim() ? `The user's current agenda: ${opts.agenda.trim()}` : "",
    opts.thread.opAuthor && opts.thread.opText
      ? `Thread context: ${opts.thread.opAuthor}: ${opts.thread.opText}`
      : "",
    opts.stance?.trim()
      ? `Take this side (do not sit the fence): ${opts.stance.trim()}`
      : "",
    `Reply to this post by ${opts.thread.author}:\n${opts.thread.text}`,
  ].filter(Boolean);
  const first = await chat({
    messages: [
      { role: "system", content: SUGGEST_SYSTEM },
      { role: "user", content: parts.join("\n\n") },
    ],
    model: resolveFlashModel(),
    temperature: 0.7,
    purpose: "reply_suggest",
  });
  if (!first.ok) {
    return { ok: false, error: first.error, message: first.message };
  }
  let draft = sanitizeSuggestedDraft(cleanDraft(first.content));
  if (draft && draftHasAiTropes(draft)) {
    const retry = await chat({
      messages: [
        { role: "system", content: SUGGEST_SYSTEM },
        { role: "user", content: parts.join("\n\n") },
        { role: "assistant", content: draft },
        { role: "user", content: SLOP_RETRY },
      ],
      model: resolveFlashModel(),
      temperature: 0.6,
      purpose: "reply_suggest",
    });
    if (retry.ok) {
      draft = sanitizeSuggestedDraft(cleanDraft(retry.content));
    }
  }
  if (!draft) {
    return {
      ok: false,
      error: "empty_draft",
      message: "The draft came back empty. Try again.",
    };
  }
  if (draftHasAiTropes(draft)) {
    return {
      ok: false,
      error: "draft_slop",
      message: "That draft still read as stock AI. Try Suggest again.",
    };
  }
  return { ok: true, draft, model: first.model };
}

export type VerifyVerdict = { ok: boolean; reason: string };

export function parseVerifyJson(raw: string): VerifyVerdict | null {
  const data = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!data || typeof data.ok !== "boolean") return null;
  const reason = typeof data.reason === "string" ? data.reason.trim() : "";
  return { ok: data.ok, reason };
}

const VERIFY_SYSTEM = `You check whether a human meaningfully rewrote an AI reply draft before posting it. The bar: they must have engaged with the text — changed wording, structure, or substance — not just punctuation, casing, spacing, or one swapped word.
PASS (ok=true): reworded a clause or more, added or removed a thought, changed the angle, rewrote in their own phrasing — even if the meaning is the same.
FAIL (ok=false): identical or near-identical; only punctuation/case/whitespace; only one or two words swapped for synonyms; only an emoji or period added.
Return ONLY JSON: {"ok":true|false,"reason":"one short, kind sentence addressed to the writer"}. If ok=false the reason should nudge them to make a real change, warmly — never scold.`;

export async function verifyReplyEdit(opts: {
  draft: string;
  edited: string;
  chat?: ChatFn;
}): Promise<
  | { ok: true; verdict: VerifyVerdict; model: string }
  | { ok: false; error: string; message: string }
> {
  const chat = opts.chat ?? chatCompletions;
  const result = await chat({
    messages: [
      { role: "system", content: VERIFY_SYSTEM },
      {
        role: "user",
        content: `AI draft:\n${opts.draft}\n\nTheir rewrite:\n${opts.edited}`,
      },
    ],
    model: resolveFlashModel(),
    temperature: 0,
    purpose: "reply_verify",
  });
  if (!result.ok) {
    return { ok: false, error: result.error, message: result.message };
  }
  const verdict = parseVerifyJson(result.content);
  if (!verdict) {
    return {
      ok: false,
      error: "verify_parse_failed",
      message: "The verifier returned an unreadable answer. Try again.",
    };
  }
  return { ok: true, verdict, model: result.model };
}
