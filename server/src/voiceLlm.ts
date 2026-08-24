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
  textUsesContrastCadence,
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
  starter?: boolean;
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

export function parseStarterVoiceCardJson(raw: string): VoiceCard | null {
  const data = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!data) return null;
  const tone = typeof data.tone === "string" ? data.tone.trim() : "";
  if (!tone) return null;
  return {
    tone,
    typicalLength: "",
    habits: [],
    neverDo: [],
    examples: [],
    starter: true,
  };
}

const CARD_SYSTEM = `You are a writing-voice analyst. You get one X user's own public posts (originals and replies). Describe how they write so a drafting assistant can imitate them.
Return ONLY a JSON object:
{"tone":"one or two sentences, plain words","typicalLength":"e.g. one short sentence, 8-20 words","habits":["3-8 concrete habits: openers, punctuation, slang, emoji use"],"neverDo":["2-6 things they never do"],"examples":["8-12 verbatim posts from the input that best show the voice"]}
Rules: examples must be copied verbatim from the input posts. Plain language, no flattery, no markdown fences.`;

const STARTER_CARD_SYSTEM = `You are a writing-voice analyst. You get a small sample of one X user's own public posts. The sample is too small for confident examples or detailed habits.
Return ONLY a JSON object:
{"tone":"one cautious sentence in plain words describing only the tone visible in the supplied posts"}
Rules: do not quote, paraphrase, invent, or claim example posts. Do not infer habits, length, preferences, or things they never do. No flattery, no markdown fences.`;

export async function generateVoiceCard(opts: {
  handle: string;
  replies: VoiceReplyRow[];
  starter?: boolean;
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
      {
        role: "system",
        content: opts.starter ? STARTER_CARD_SYSTEM : CARD_SYSTEM,
      },
      { role: "user", content: user },
    ],
    model: resolveFlashModel(),
    temperature: 0.4,
    purpose: "voice_card",
  });
  if (!result.ok) {
    return { ok: false, error: result.error, message: result.message };
  }
  const card = opts.starter
    ? parseStarterVoiceCardJson(result.content)
    : parseVoiceCardJson(result.content);
  if (!card) {
    return {
      ok: false,
      error: "card_parse_failed",
      message: "Voice model returned an unreadable card. The hourly ingest will try again.",
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

const SUGGEST_COMPOSE_SYSTEM = `You draft ONE original X post in this specific human's voice. The voice card and example posts are the source of truth. Imitate them, not a generic assistant.
Rules:
- Match their tone, typical length, and habits. Respect every neverDo. Steal cadence from the examples.
- This is a standalone post, not a reply. No hashtags unless they habitually use them. No @-mentions.
- If they are quoting another post, write only the quote caption. Do not repeat the quoted post.
- Under 260 characters. Plain text only. No quotes around it, no markdown, no explanation.
- Add something real (a take, a fact, a question). Never "great post!" filler.
- Never use an em dash. Use a period, comma, or "and".
- Never write "if X, then Y" formulas.
- Never write "this isn't X, it's Y" or "it's not X, it's Y" contrast templates.`;

const SLOP_RETRY = `Rewrite that reply. Stay in the voice card. No em dashes. No "if X, then Y". No "this isn't X, it's Y" / "it's not X, it's Y".`;

const SLOP_RETRY_COMPOSE = `Rewrite that post. Stay in the voice card. No em dashes. No "if X, then Y". No "this isn't X, it's Y" / "it's not X, it's Y".`;

function cardAllowsContrastCadence(cardJson: string): boolean {
  try {
    const card = JSON.parse(cardJson) as VoiceCard;
    return (card.examples ?? []).some((example) =>
      textUsesContrastCadence(example),
    );
  } catch {
    return false;
  }
}

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
  /** Original / quote on their timeline, not a reply to someone else. */
  mode?: "reply" | "compose";
  composeKind?: "post" | "quote";
  chat?: ChatFn;
}): Promise<
  | { ok: true; draft: string; model: string }
  | { ok: false; error: string; message: string }
> {
  const chat = opts.chat ?? chatCompletions;
  const allowContrastCadence = cardAllowsContrastCadence(opts.cardJson);
  const compose = opts.mode === "compose";
  const quote = compose && opts.composeKind === "quote";
  const parts = [
    `Voice card JSON:\n${opts.cardJson}`,
    opts.agenda?.trim() ? `The user's current agenda: ${opts.agenda.trim()}` : "",
    opts.thread.opAuthor && opts.thread.opText
      ? `Thread context: ${opts.thread.opAuthor}: ${opts.thread.opText}`
      : "",
    opts.stance?.trim()
      ? `Take this side (do not sit the fence): ${opts.stance.trim()}`
      : "",
    compose
      ? quote
        ? `Write a quote caption. The daily digest proposed this thought about a post by ${opts.thread.author}:\n${opts.thread.text}`
        : `Write an original post. The daily digest proposed this thought:\n${opts.thread.text}`
      : `Reply to this post by ${opts.thread.author}:\n${opts.thread.text}`,
  ].filter(Boolean);
  const system = compose ? SUGGEST_COMPOSE_SYSTEM : SUGGEST_SYSTEM;
  const purpose = compose ? "compose_suggest" : "reply_suggest";
  const first = await chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: parts.join("\n\n") },
    ],
    model: resolveFlashModel(),
    temperature: 0.7,
    purpose,
  });
  if (!first.ok) {
    return { ok: false, error: first.error, message: first.message };
  }
  let rawDraft = cleanDraft(first.content);
  let draft = sanitizeSuggestedDraft(rawDraft);
  if (draft && draftHasAiTropes(draft, rawDraft, { allowContrastCadence })) {
    const retry = await chat({
      messages: [
        { role: "system", content: system },
        { role: "user", content: parts.join("\n\n") },
        { role: "assistant", content: draft },
        { role: "user", content: compose ? SLOP_RETRY_COMPOSE : SLOP_RETRY },
      ],
      model: resolveFlashModel(),
      temperature: 0.6,
      purpose,
    });
    if (retry.ok) {
      rawDraft = cleanDraft(retry.content);
      draft = sanitizeSuggestedDraft(rawDraft);
    } else {
      return { ok: false, error: retry.error, message: retry.message };
    }
  }
  if (!draft) {
    return {
      ok: false,
      error: "empty_draft",
      message: "The draft came back empty. Try again.",
    };
  }
  if (draftHasAiTropes(draft, rawDraft, { allowContrastCadence })) {
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

export const FALLBACK_STANCES = ["Agree with this", "Push back", "Another angle"];

const STANCE_SYSTEM = `You list 2 or 3 sides a human could take when replying to this X post.
Return ONLY JSON: {"options":["short side 1","short side 2","short side 3"]}
Rules: each option is under 8 words, names a real angle on THIS post (a take, an answer, or a disagreement), no em dashes, no "this isn't X" templates. Always return at least two options — questions and fact posts still have sides (what you'd emphasize, who you'd back, what you'd challenge).`;

const STANCE_COMPOSE_SYSTEM = `You list 2 or 3 sides a human could take when writing this original X post (or quote caption).
Return ONLY JSON: {"options":["short side 1","short side 2","short side 3"]}
Rules: each option is under 8 words, names a real take (lean in harder, push back, a sharper claim, a different example), no em dashes, no "this isn't X" templates. Always return at least two options.`;

export function parseStanceOptions(raw: string): string[] {
  const data = extractJsonObject(raw) as { options?: unknown } | null;
  if (!data || !Array.isArray(data.options)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of data.options) {
    if (typeof item !== "string") continue;
    const label = item.replace(/\u2014/g, " ").replace(/\s+/g, " ").trim();
    const key = label.toLowerCase();
    if (!label || label.length > 60 || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length === 3) break;
  }
  return out;
}

export type StanceProposal =
  | { ok: true; needed: false; options: string[]; fallback: false }
  | { ok: true; needed: true; options: string[]; fallback: boolean }
  | { ok: false; error: string; message: string };

export async function proposeStances(opts: {
  thread: {
    author: string;
    text: string;
    threadKind?: string;
    flags?: string[];
    opAuthor?: string;
    opText?: string;
  };
  mode?: "reply" | "compose";
  chat?: ChatFn;
}): Promise<StanceProposal> {
  const chat = opts.chat ?? chatCompletions;
  const compose = opts.mode === "compose";
  const parts = [
    opts.thread.opAuthor && opts.thread.opText
      ? `Thread context: ${opts.thread.opAuthor}: ${opts.thread.opText}`
      : "",
    compose
      ? `Proposed original post:\n${opts.thread.text}`
      : `Post by ${opts.thread.author}:\n${opts.thread.text}`,
  ].filter(Boolean);
  const result = await chat({
    messages: [
      { role: "system", content: compose ? STANCE_COMPOSE_SYSTEM : STANCE_SYSTEM },
      { role: "user", content: parts.join("\n\n") },
    ],
    model: resolveFlashModel(),
    temperature: 0.4,
    purpose: compose ? "compose_stances" : "reply_stances",
  });
  if (!result.ok) {
    console.error(
      `[llm] purpose=reply_stances failed error=${result.error} message=${result.message}`,
    );
    return { ok: false, error: result.error, message: result.message };
  }
  const options = parseStanceOptions(result.content);
  if (options.length >= 2) return { ok: true, needed: true, options, fallback: false };
  // The metadata gate said this post takes a side; when the model finds no
  // side, fall back to generic sides instead of silently drafting un-picked.
  return { ok: true, needed: true, options: FALLBACK_STANCES, fallback: true };
}
