/**
 * One DeepSeek pass that turns a SQL digest into 2–4 For You actions.
 */
import {
  chatCompletions,
  type ChatCompletionResult,
  type ChatMessage,
} from "../platform/deepseek.js";
import { extractJsonObject, type ChatFn } from "../platform/llmJson.js";
import {
  filterDigestActions,
  filterExtraPosts,
  type ForYouDigest,
} from "./forYouDigest.js";
import type { ForYouAction } from "./forYouStore.js";

export const FOR_YOU_DIGEST_SYSTEM = `You pick the operator's next X moves from their agenda and a ranked digest of THEIR posts and memories. You never write post text for them. They open X and write every word themselves.
Return ONLY JSON:
{"actions":[{"kind":"post"|"quote"|"repost"|"reply","why":"one short clause, max 90 characters, grounded in the agenda or an eligible memory","targetId":"id from the digest when kind is quote, repost, or reply","targetUrl":"url from the digest when you have one","targetAuthor":"@handle when you have one"}]}
Rules:
- 2 to 4 actions. Mix kinds when the digest supports it. At least one kind=post.
- Never write a draft, caption, reply text, or example wording. No quoted lines. The why is a nudge, not the post.
- kind=post is a NEW angle from the agenda. The why names that angle or topic so they know what to write about, and hints that the post should invite replies. Do not name, rewrite, or "fix" an own post. no targetId.
- Never pitch a move because an old post "only got N views." Never "sharper hook." Never "double down" on a specific old topic.
- BEST_24H (100+ views only) and RECENT_* are context only. Never quote or repost an own post, and never emit an own-post targetId or targetUrl for those kinds. If BEST_24H is empty, there is no winner — do not invent one from RECENT_* or by ranking 25 views over 5.
- Under 100 views is a miss for anyone. Never call a 25-view post "better", "best", or worth doubling down on versus a 5-view post. Both failed.
- AVOID_24H and thin memories are what not to repeat. Never reply, quote, or repost to "boost" a low-view item.
- kind=quote: targetId/targetUrl MUST be copied from an allowed non-own target in the digest.
- kind=repost: targetId/targetUrl MUST be copied from an allowed non-own target in the digest. no invented posts.
- kind=reply: a memory that already earned attention. Not a Scout tank thread or flopped own post.
- why talks to the operator in second person. Never first person.
- why is one short clause, max 90 characters. Cite the agenda or eligible memory, not a view count. No second sentence.
- RECENT_* omits posts younger than 1 hour. Do not treat 0 views as a flop unless the post is in AVOID_24H.
- SKIPPED_RECENT is an operator veto. Do not repeat those targets, angles, or the same why. If they skipped a BEST double-down, pick a different angle from the agenda — not another remix.
- Do not invent ids or urls. Do not auto-post. Plain language. No markdown fences.`;

function buildUserPrompt(digest: ForYouDigest): string {
  return [
    "AGENDA",
    digest.agenda ?? "(none)",
    "",
    "BEST_24H (100+ views only — context only. Never quote/repost these own posts. Empty = no winner. Do not rewrite these topics as a new original)",
    JSON.stringify(digest.best),
    "",
    "AVOID_24H (do not revive — do not reply/quote/repost these)",
    JSON.stringify(digest.worst),
    "",
    "RECENT_ORIGINALS (context only — never quote/repost these own posts)",
    JSON.stringify(digest.recentOriginals),
    "",
    "RECENT_REPLIES (context only — never quote/repost these own posts)",
    JSON.stringify(digest.recentReplies),
    "",
    "RECENT_QUOTES (context only — never quote/repost these own posts)",
    JSON.stringify(digest.recentQuotes),
    "",
    "MEMORIES",
    JSON.stringify(digest.memories),
    "",
    "SKIPPED_RECENT (operator veto — do not rewrite these)",
    JSON.stringify(digest.skipped),
  ].join("\n");
}

export type ForYouActionResult =
  | { ok: true; actions: ForYouAction[] }
  | { ok: false; error: string; exhausted?: boolean };

export async function pickForYouActions(opts: {
  digest: ForYouDigest;
  chat?: ChatFn;
}): Promise<ForYouActionResult> {
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
    return { ok: true, actions: parsed };
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
          'Reply again with ONLY {"actions":[...]} using 2-4 items. Include at least one kind=post whose why names an angle from the agenda (not a rewrite of an own post). Every targetId/targetUrl must be copied from the digest. kind=post has no target. No action carries post text or a draft.',
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
  return { ok: true, actions: parsed };
}

export const FOR_YOU_SCOUT_ORIGINAL_SYSTEM = `You pick ONE original X post angle from the agenda. You never write the post. The operator opens X and writes every word themselves.
Return ONLY JSON:
{"actions":[{"kind":"post","why":"one short clause, max 90 characters, naming the angle or topic from the agenda"}]}
Rules:
- Exactly 1 kind=post. no targetId. No draft, caption, or example wording. No quoted lines.
- Topic from the agenda only. New angle. Do not name, rewrite, or "fix" an own post.
- The why is a nudge toward a post that invites replies — a real question, a stake, or a named other side. Not the post itself.
- Never cite a view count. Never "sharper hook." Never "double down."
- why talks to the operator in second person. No second sentence.
- Do not invent ids or urls. Do not auto-post. Plain language. No markdown fences.`;

export async function pickForYouScoutOriginal(opts: {
  digest: ForYouDigest;
  chat?: ChatFn;
}): Promise<ForYouActionResult> {
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
  if (parsed.length >= 1) return { ok: true, actions: parsed.slice(0, 1) };
  return { ok: false, error: "no scout original", exhausted: true };
}

export type { ChatCompletionResult, ChatMessage };
