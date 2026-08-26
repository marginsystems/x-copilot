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

export const FOR_YOU_DIGEST_SYSTEM = `You pick the operator's next X moves from a ranked digest of THEIR posts, marked memories, voice card, agenda, and leftover Scout threads.
Return ONLY JSON:
{"actions":[{"kind":"post"|"quote"|"repost"|"reply","why":"one sentence grounded in a metric or habit","draft":"text when kind is post or quote","targetId":"id from the digest when kind is quote, repost, or reply","targetUrl":"url from the digest when you have one","targetAuthor":"@handle when you have one"}]}
Rules:
- 2 to 4 actions. Mix kinds when the digest supports it. At least one kind=post.
- BEST_24H is what worked. Double down: write the next original in that shape, or quote/repost those ids.
- AVOID_24H and thin memories are what not to repeat. Never reply, quote, or repost to "boost" a low-view item. Never pitch a move because something "only got N views."
- kind=post: original in their voice, echoing BEST_24H. draft required. no targetId. The draft must invite a reply — a real question, a stake they can cut, or a named other side. Not a slogan. Not "thoughts?".
- kind=quote: draft required. targetId/targetUrl MUST be copied from BEST_24H or a strong recent, not AVOID.
- kind=repost: targetId/targetUrl MUST be copied from the digest. no invented posts. Prefer BEST.
- kind=reply: leftover Scout, or a memory that already earned attention. Not a flopped own post.
- why talks to the operator in second person ("Your originals…", "You got 900 views…"). Never first person ("My posts…", "I got…") — the copilot is not the user. draft stays in their voice.
- why must cite a number or habit from the digest (views, likes, reply rate, tone) — prefer winners.
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
    "BEST_24H (double down — write like these, or quote/repost them)",
    JSON.stringify(digest.best),
    "",
    "AVOID_24H (do not revive — do not reply/quote/repost these)",
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
      { role: "system", content: FOR_YOU_DIGEST_SYSTEM },
      { role: "user", content: user },
    ],
  });
  if (!first.ok) return { ok: false, error: first.message };
  let parsed = filterDigestActions(extractJsonObject(first.content), opts.digest);
  if (parsed.length >= 2 && parsed.some((a) => a.kind === "post")) {
    return { ok: true, drafts: parsed };
  }

  const repair = await chat({
    purpose: "for_you_digest_repair",
    temperature: 0.2,
    messages: [
      { role: "system", content: FOR_YOU_DIGEST_SYSTEM },
      { role: "user", content: user },
      { role: "assistant", content: first.content },
      {
        role: "user",
        content:
          'Reply again with ONLY {"actions":[...]} using 2-4 items. Include at least one kind=post whose draft invites a reply (a real question, a stake, or a named other side). Every targetId/targetUrl must be copied from the digest. kind=post needs a draft and no target.',
      },
    ],
  });
  if (!repair.ok) return { ok: false, error: repair.message };
  parsed = filterDigestActions(extractJsonObject(repair.content), opts.digest);
  if (parsed.length < 2 || !parsed.some((a) => a.kind === "post")) {
    return { ok: false, error: "repair did not return 2+ actions with a kind=post" };
  }
  return { ok: true, drafts: parsed };
}

export type { ChatCompletionResult, ChatMessage };
