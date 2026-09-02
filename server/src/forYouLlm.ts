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
  filterExtraPosts,
  type ForYouDigest,
} from "./forYouDigest.js";
import type { ForYouDraft } from "./forYouStore.js";

export const FOR_YOU_DIGEST_SYSTEM = `You pick the operator's next X moves from live Scout threads, their agenda, voice card, and a ranked digest of THEIR posts.
Return ONLY JSON:
{"actions":[{"kind":"post"|"quote"|"repost"|"reply","why":"one short clause, max 90 characters, grounded in a live Scout thread or the agenda","draft":"text when kind is post or quote","targetId":"id from the digest when kind is quote, repost, or reply","targetUrl":"url from the digest when you have one","targetAuthor":"@handle when you have one"}]}
Rules:
- 2 to 4 actions. Mix kinds when the digest supports it. At least one kind=post.
- kind=post is a NEW angle from LIVE_SCOUT or the agenda. Voice and length may echo BEST_24H. Do not name, rewrite, or "fix" an own post. draft required. no targetId. The draft must invite a reply — a real question, a stake they can cut, or a named other side. Not a slogan. Not "thoughts?".
- Never pitch a move because an old post "only got N views." Never "sharper hook." Never "double down" on a specific old topic.
- BEST_24H is what worked (100+ views only). Quote/repost those ids if you use them. Voice only for originals. If BEST_24H is empty, there is no winner — do not invent one from RECENT_* or by ranking 25 views over 5.
- Under 100 views is a miss for anyone. Never call a 25-view post "better", "best", or worth doubling down on versus a 5-view post. Both failed.
- AVOID_24H and thin memories are what not to repeat. Never reply, quote, or repost to "boost" a low-view item.
- kind=quote: draft required. targetId/targetUrl MUST be copied from BEST_24H or a strong recent, not AVOID.
- kind=repost: targetId/targetUrl MUST be copied from the digest. no invented posts. Prefer BEST.
- kind=reply: LIVE_SCOUT, or a memory that already earned attention. Not a flopped own post.
- why talks to the operator in second person. Never first person. draft stays in their voice.
- why is one short clause, max 90 characters. Cite the live thread or agenda, not a view count. No second sentence.
- RECENT_* omits posts younger than 1 hour. Do not treat 0 views as a flop unless the post is in AVOID_24H.
- SKIPPED_RECENT is an operator veto. Do not rewrite those targets, drafts, or the same why. If they skipped a BEST double-down, pick a different angle from agenda or voice — not another remix.
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
    "BEST_24H (100+ views only — voice/cadence, or quote/repost those ids. Empty = no winner. Do not rewrite these topics as a new original)",
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
    "LIVE_SCOUT (new original angles come from these threads)",
    JSON.stringify(digest.leftoverScout),
    "",
    "SKIPPED_RECENT (operator veto — do not rewrite these)",
    JSON.stringify(digest.skipped),
  ].join("\n");
}

export type ForYouDraftResult =
  | { ok: true; drafts: ForYouDraft[] }
  | { ok: false; error: string; exhausted?: boolean };

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
          'Reply again with ONLY {"actions":[...]} using 2-4 items. Include at least one kind=post whose topic comes from LIVE_SCOUT or the agenda (not a rewrite of an own post) and whose draft invites a reply. Every targetId/targetUrl must be copied from the digest. kind=post needs a draft and no target.',
      },
    ],
  });
  if (!repair.ok) return { ok: false, error: repair.message };
  parsed = filterDigestActions(extractJsonObject(repair.content), opts.digest);
  if (parsed.length < 2 || !parsed.some((a) => a.kind === "post")) {
    return {
      ok: false,
      error: "repair did not return 2+ actions with a kind=post",
      exhausted: true,
    };
  }
  return { ok: true, drafts: parsed };
}

export const FOR_YOU_EXTRA_SYSTEM = `You write 3 original X posts for this operator from live Scout threads, agenda, and voice.
Return ONLY JSON:
{"actions":[{"kind":"post","why":"one short clause, max 90 characters, grounded in a live Scout thread or the agenda","draft":"the original post"}]}
Rules:
- Exactly 3 kind=post items. draft required. no targetId.
- Each draft is a NEW angle from LIVE_SCOUT or the agenda. Voice may echo BEST_24H. Do not name, rewrite, or "fix" an own post.
- Each draft invites a reply — a real question, a stake they can cut, or a named other side. Not a slogan. Not "thoughts?".
- Echo BEST_24H shape and their voice when BEST is non-empty (100+ views). If BEST is empty, write from agenda/voice — do not treat a sub-100 RECENT post as a winner. Do not revive AVOID_24H or SKIPPED_RECENT.
- Never cite a view count. Never "sharper hook." Never "double down" on a specific old topic.
- why talks to the operator in second person. Never first person. draft stays in their voice.
- why is one short clause, max 90 characters. No second sentence.
- Do not invent ids or urls. Do not auto-post. Plain language. No markdown fences.`;

export async function draftForYouExtraPosts(opts: {
  digest: ForYouDigest;
  chat?: ChatFn;
}): Promise<ForYouDraftResult> {
  const chat = opts.chat ?? chatCompletions;
  const user = buildUserPrompt(opts.digest);
  const first = await chat({
    purpose: "for_you_extra",
    temperature: 0.5,
    messages: [
      { role: "system", content: FOR_YOU_EXTRA_SYSTEM },
      { role: "user", content: user },
    ],
  });
  if (!first.ok) return { ok: false, error: first.message };
  let parsed = filterExtraPosts(extractJsonObject(first.content), opts.digest.skipped);
  if (parsed.length >= 3) return { ok: true, drafts: parsed.slice(0, 3) };

  const repair = await chat({
    purpose: "for_you_extra_repair",
    temperature: 0.3,
    messages: [
      { role: "system", content: FOR_YOU_EXTRA_SYSTEM },
      { role: "user", content: user },
      { role: "assistant", content: first.content },
      {
        role: "user",
        content:
          'Reply again with ONLY {"actions":[...]} using exactly 3 kind=post items from LIVE_SCOUT or the agenda. Each draft invites a reply. Do not rewrite an own post.',
      },
    ],
  });
  if (!repair.ok) return { ok: false, error: repair.message };
  parsed = filterExtraPosts(
    extractJsonObject(repair.content),
    opts.digest.skipped,
  );
  if (parsed.length < 3) {
    return {
      ok: false,
      error: "repair did not return 3 originals",
      exhausted: true,
    };
  }
  return { ok: true, drafts: parsed.slice(0, 3) };
}

export const FOR_YOU_SCOUT_ORIGINAL_SYSTEM = `You write ONE original X post from live Scout threads and the agenda.
Return ONLY JSON:
{"actions":[{"kind":"post","why":"one short clause, max 90 characters, grounded in a live Scout thread or the agenda","draft":"the original post"}]}
Rules:
- Exactly 1 kind=post. draft required. no targetId.
- Topic from LIVE_SCOUT or the agenda. New angle. Voice may echo BEST_24H. Do not name, rewrite, or "fix" an own post.
- The draft invites a reply — a real question, a stake, or a named other side. Not a slogan. Not "thoughts?".
- Never cite a view count. Never "sharper hook." Never "double down."
- why talks to the operator in second person. No second sentence.
- Do not invent ids or urls. Do not auto-post. Plain language. No markdown fences.`;

export async function draftForYouScoutOriginal(opts: {
  digest: ForYouDigest;
  chat?: ChatFn;
}): Promise<ForYouDraftResult> {
  const chat = opts.chat ?? chatCompletions;
  const user = buildUserPrompt(opts.digest);
  const first = await chat({
    purpose: "for_you_scout_original",
    temperature: 0.5,
    messages: [
      { role: "system", content: FOR_YOU_SCOUT_ORIGINAL_SYSTEM },
      { role: "user", content: user },
    ],
  });
  if (!first.ok) return { ok: false, error: first.message };
  const parsed = filterExtraPosts(extractJsonObject(first.content));
  if (parsed.length >= 1) return { ok: true, drafts: parsed.slice(0, 1) };
  return { ok: false, error: "no scout original", exhausted: true };
}

export type { ChatCompletionResult, ChatMessage };
