/**
 * First-run onboarding: answers → 2–3 Scout agendas, then persist the pick.
 */
import {
  addTokenUsage,
  chatCompletions,
  normalizeLlmProvider,
  resolveFlashModel,
  type LlmProvider,
  type TokenUsage,
} from "./deepseek.js";

export const MIN_AGENDA_CHARS = 40;
export const MAX_AGENDA_CHARS = 5000;
export const MIN_AGENDA_OPTIONS = 2;
export const MAX_AGENDA_OPTIONS = 3;
const MAX_LABELS = 8;
const MAX_LABEL_CHARS = 80;

export type OnboardingAnswers = {
  topics: string[];
  goals: string[];
  audiences: string[];
};

export type OnboardingAgenda = {
  title: string;
  body: string;
  recommended: boolean;
};

export type GenerateAgendasResult =
  | {
      ok: true;
      agendas: OnboardingAgenda[];
      source: "llm" | "fallback";
      model?: string;
      provider?: LlmProvider;
      usage?: TokenUsage;
    }
  | { ok: false; error: string; message: string };

export function validateAgendaText(
  value: unknown,
): { ok: true; agenda: string } | { ok: false; error: string; message: string } {
  if (typeof value !== "string") {
    return {
      ok: false,
      error: "bad_request",
      message: "Pass { agenda: string }.",
    };
  }
  const agenda = value.trim();
  if (agenda.length < MIN_AGENDA_CHARS) {
    return {
      ok: false,
      error: "agenda_too_short",
      message: `Agenda must be at least ${MIN_AGENDA_CHARS} characters.`,
    };
  }
  if (agenda.length > MAX_AGENDA_CHARS) {
    return {
      ok: false,
      error: "agenda_too_long",
      message: `Agenda exceeds ${MAX_AGENDA_CHARS} characters.`,
    };
  }
  return { ok: true, agenda };
}

export function parseLabelList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const labels = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= MAX_LABEL_CHARS),
    ),
  ].slice(0, MAX_LABELS);
  return labels.length > 0 ? labels : null;
}

export function validateOnboardingAnswers(
  body: Record<string, unknown>,
):
  | { ok: true; answers: OnboardingAnswers }
  | { ok: false; error: string; message: string } {
  const topics = parseLabelList(body.topics);
  const goals = parseLabelList(body.goals);
  const audiences = parseLabelList(body.audiences);
  if (!topics || !goals || !audiences) {
    return {
      ok: false,
      error: "bad_request",
      message:
        "Pass { topics, goals, audiences } as non-empty string arrays.",
    };
  }
  return { ok: true, answers: { topics, goals, audiences } };
}

const SYSTEM = `You write Scout agendas for x-copilot, a research desk for posting on X.
An agenda is 2–4 sentences of search/triage intent: who/what to find, what to prefer, what to skip.
Do not mention auto-engage, AI drafts, or posting on the user's behalf. Humans review and reply themselves.

Return ONLY valid JSON:
{"agendas":[{"title":"...","body":"...","recommended":true},{"title":"...","body":"...","recommended":false}]}

Rules:
- Emit 2 or 3 agendas. Titles are 3–6 words. Bodies are 2–4 sentences, ${MIN_AGENDA_CHARS}–500 characters.
- Exactly one recommended: true (the best overall fit). Others false.
- Make the three options distinct angles (e.g. reply-first, research-first, people-first) from the same answers.
- Sound like a sharp operator, not marketing copy. No hashtags, no emoji, no markdown.
- English unless the answers clearly require another language.`;

export function parseOnboardingAgendasJson(
  raw: string,
): OnboardingAgenda[] | null {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as {
      agendas?: unknown;
    };
    return validateOnboardingAgendas(data.agendas);
  } catch {
    return null;
  }
}

export function validateOnboardingAgendas(
  value: unknown,
): OnboardingAgenda[] | null {
  if (!Array.isArray(value)) return null;
  const cleaned: OnboardingAgenda[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title =
      typeof row.title === "string" ? row.title.trim().slice(0, 80) : "";
    const body = typeof row.body === "string" ? row.body.trim() : "";
    if (!title || body.length < MIN_AGENDA_CHARS || body.length > MAX_AGENDA_CHARS) {
      continue;
    }
    cleaned.push({
      title,
      body,
      recommended: row.recommended === true,
    });
    if (cleaned.length >= MAX_AGENDA_OPTIONS) break;
  }
  if (cleaned.length < MIN_AGENDA_OPTIONS) return null;
  const recIdx = cleaned.findIndex((a) => a.recommended);
  if (recIdx === -1) {
    cleaned[0].recommended = true;
  } else {
    cleaned.forEach((a, i) => {
      a.recommended = i === recIdx;
    });
  }
  return cleaned;
}

function joinLabels(labels: string[]): string {
  return labels.join(", ");
}

export function fallbackAgendas(
  answers: OnboardingAnswers,
): OnboardingAgenda[] {
  const topics = joinLabels(answers.topics);
  const people = joinLabels(answers.audiences);
  const goals = joinLabels(answers.goals);
  return [
    {
      title: "Reply to real takes",
      body: `Find ${people} posting opinions, tradeoffs, or concrete takes about ${topics}. Prefer a clear point of view or a specific claim I can agree or disagree with. Skip empty polls, “drop your stack” bait, and open-ended engagement questions even when they mention the same topics.`,
      recommended: true,
    },
    {
      title: "Research the niche",
      body: `Scout ${topics} conversations among ${people} so I can stay current. Prefer lived results, sharp disagreements, and posts that teach something specific. Skip launch-day hype, newsletter dumps, and threads that exist only to farm replies. Goal: ${goals}.`,
      recommended: false,
    },
    {
      title: "Meet the right people",
      body: `Look for ${people} talking in public about ${topics} who sound worth knowing. Prefer introductions of work, asks with substance, and people thinking out loud. Skip generic networking spam, follow-for-follow, and hollow “who should I talk to?” posts.`,
      recommended: false,
    },
  ];
}

function buildUserPrompt(answers: OnboardingAnswers): string {
  return [
    `Topics: ${JSON.stringify(answers.topics)}`,
    `Goals: ${JSON.stringify(answers.goals)}`,
    `Audiences: ${JSON.stringify(answers.audiences)}`,
    "Respond with JSON only.",
  ].join("\n");
}

export async function generateOnboardingAgendas(
  answers: OnboardingAnswers,
  opts?: { provider?: unknown },
): Promise<GenerateAgendasResult> {
  const provider = normalizeLlmProvider(opts?.provider);
  const model = resolveFlashModel(provider);
  const userPrompt = buildUserPrompt(answers);

  const first = await chatCompletions({
    provider,
    model,
    purpose: "onboarding",
    temperature: 0.6,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });

  if (first.ok) {
    let agendas = parseOnboardingAgendasJson(first.content);
    let usage = first.usage;
    let usedModel = first.model;
    if (!agendas) {
      const repair = await chatCompletions({
        provider,
        model,
        purpose: "onboarding_repair",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
          { role: "assistant", content: first.content },
          {
            role: "user",
            content:
              'Your previous reply was not valid JSON of the form {"agendas":[{"title","body","recommended"}]}. Reply again with ONLY that JSON, 2 or 3 agendas, exactly one recommended.',
          },
        ],
      });
      if (repair.ok) {
        agendas = parseOnboardingAgendasJson(repair.content);
        usage = addTokenUsage(usage, repair.usage);
        usedModel = repair.model;
      }
    }
    if (agendas) {
      return {
        ok: true,
        agendas,
        source: "llm",
        model: usedModel,
        provider,
        ...(usage ? { usage } : {}),
      };
    }
  }

  return {
    ok: true,
    agendas: fallbackAgendas(answers),
    source: "fallback",
    provider,
  };
}
