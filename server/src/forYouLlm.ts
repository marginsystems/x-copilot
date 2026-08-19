/**
 * One DeepSeek pass that turns a SQL digest into 2–4 For You actions.
 */
import {
  chatCompletions,
  type ChatCompletionResult,
  type ChatMessage,
} from "./deepseek.js";
import { extractJsonObject, type ChatFn } from "./voiceLlm.js";
import {
  filterDigestActions,
  type ForYouDigest,
} from "./forYouDigest.js";
import type { ForYouDraft } from "./forYouStore.js";

const SYSTEM = `You pick the operator's next X moves from a ranked digest of THEIR posts, marked memories, voice card, agenda, and leftover Scout threads.
Return ONLY JSON:
{"actions":[{"kind":"post"|"quote"|"repost"|"reply","why":"one sentence grounded in a metric or habit","draft":"text when kind is post or quote","targetId":"id from the digest when kind is quote, repost, or reply","targetUrl":"url from the digest when you have one","targetAuthor":"@handle when you have one"}]}
Rules:
- 2 to 4 actions. Mix kinds when the digest supports it.
- kind=post: original in their voice. draft required. no targetId.
- kind=quote: draft required. targetId/targetUrl MUST be copied from the digest.
- kind=repost: targetId/targetUrl MUST be copied from the digest. no invented posts.
- kind=reply: target MUST be a leftover Scout or memory thread id from the digest.
- why must cite a number or habit from the digest (views, likes, reply rate, tone).
- Do not invent ids or urls. Do not auto-post. Plain language. No markdown fences.`;

function buildUserPrompt(digest: ForYouDigest): string {
  return [
    "AGENDA",
    digest.agenda ?? "(none)",
    "",
    "VOICE",
    digest.voice
      ? JSON.stringify({
          tone: digest.voice.tone,
          typicalLength: digest.voice.typicalLength,
          habits: digest.voice.habits.slice(0, 6),
          neverDo: digest.voice.neverDo.slice(0, 4),
        })
      : "(none)",
    "",
    "BEST_24H",
    JSON.stringify(digest.best),
    "",
    "WORST_24H",
    JSON.stringify(digest.worst),
    "",
    "RECENT_ORIGINALS",
    JSON.stringify(digest.recentOriginals),
    "",
    "RECENT_REPLIES",
    JSON.stringify(digest.recentReplies),
    "",
    "RECENT_QUOTES",
    JSON.stringify(digest.recentQuotes),
    "",
    "MEMORIES",
    JSON.stringify(digest.memories),
    "",
    "LEFTOVER_SCOUT",
    JSON.stringify(digest.leftoverScout),
  ].join("\n");
}

export type ForYouDraftResult =
  | { ok: true; drafts: ForYouDraft[] }
  | { ok: false; error: string };

export async function draftForYouActions(opts: {
  digest: ForYouDigest;
  chat?: ChatFn;
}): Promise<ForYouDraftResult> {
  const chat = opts.chat ?? chatCompletions;
  const user = buildUserPrompt(opts.digest);
  const first = await chat({
    purpose: "for_you_digest",
    temperature: 0.4,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
  });
  if (!first.ok) return { ok: false, error: first.message };
  let parsed = filterDigestActions(extractJsonObject(first.content), opts.digest);
  if (parsed.length >= 2) return { ok: true, drafts: parsed };

  const repair = await chat({
    purpose: "for_you_digest_repair",
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
      { role: "assistant", content: first.content },
      {
        role: "user",
        content:
          'Reply again with ONLY {"actions":[...]} using 2-4 items. Every targetId/targetUrl must be copied from the digest. kind=post needs a draft and no target.',
      },
    ],
  });
  if (!repair.ok) return { ok: false, error: repair.message };
  parsed = filterDigestActions(extractJsonObject(repair.content), opts.digest);
  return { ok: true, drafts: parsed };
}

export type { ChatCompletionResult, ChatMessage };
