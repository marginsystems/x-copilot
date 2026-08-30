/**
 * One cheap DeepSeek call: today's next desk action.
 * Cached per user; recomputed when the coaching snapshot hash changes.
 */
import {
  chatCompletions,
  deepseekConfigured,
  resolveFlashModel,
} from "./deepseek.js";
import { getPlatformDb } from "./db.js";
import type { CoachingSnapshot } from "./coachingSnapshot.js";
import { DAILY_MISSION_DEFS } from "./dailyMissions.js";
import { extractJsonObject, type ChatFn } from "./voiceLlm.js";

/** Bump when the grounded next-action prompt changes so stale copy refreshes. */
export const NEXT_ACTION_PROMPT_REV = 4;

function missionTarget(id: string): number {
  return DAILY_MISSION_DEFS.find((row) => row.id === id)?.target ?? 0;
}

export function nextActionCacheHash(inputsHash: string): string {
  return `${NEXT_ACTION_PROMPT_REV}:${inputsHash}`;
}

export const NEXT_ACTION_KINDS = [
  "reply",
  "original",
  "takeoff",
  "quote",
  "repost",
  "for_you",
  "streak",
] as const;
export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number];

export type NextAction = {
  kind: NextActionKind;
  text: string;
  inputsHash: string;
  updatedAt: string;
  model: string;
};

export const NEXT_ACTION_SYSTEM = `You pick ONE next action for an X operator on their Flightpad desk.
Return ONLY JSON:
{"kind":"reply"|"original"|"takeoff"|"quote"|"repost"|"for_you"|"streak","text":"one imperative sentence, second person"}
Rules:
- kind must match the verb: reply (mark/reply to threads), original (write an OG post), takeoff (run Scout), quote, for_you (work a Suggested card), streak (mark today to keep the streak).
- Cite a number that appears in the input. No invented metrics, no follower counts.
- Do not invent a daily quota. The reply mission target is replyTarget (2). Cite marksToday against that. Never say hit 5 replies.
- Prefer the gap that most helps the account today. Empty marks → reply or streak. No originals after replies → original. No takeoff and no Suggested queue → takeoff. Suggested quotes waiting → quote or for_you.
- kind=original only when originalsToday < originalTarget. Do not tell them to write an original after that mission is in.
- kind=quote only when suggestions.quote > 0. kind=repost only when suggestions.repost > 0. kind=for_you only when suggestions.total > 0. Do not tell them to quote OG cards.
- Max 140 characters. No markdown.`;

function isKind(value: unknown): value is NextActionKind {
  return (
    typeof value === "string" &&
    (NEXT_ACTION_KINDS as readonly string[]).includes(value)
  );
}

export function parseNextActionJson(raw: string): {
  kind: NextActionKind;
  text: string;
} | null {
  const data = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!data || !isKind(data.kind)) return null;
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text || text.length > 180) return null;
  return { kind: data.kind, text };
}

/** Quote / repost / for_you only when those Suggested cards are still in the tray. */
export function nextActionAllowed(
  kind: NextActionKind,
  snapshot: Pick<CoachingSnapshot, "suggestions" | "originalsToday">,
): boolean {
  if (kind === "original") {
    return snapshot.originalsToday < missionTarget("original_1");
  }
  if (kind === "quote") return snapshot.suggestions.quote > 0;
  if (kind === "repost") return snapshot.suggestions.repost > 0;
  if (kind === "for_you") return snapshot.suggestions.total > 0;
  return true;
}

/** Deterministic card when DeepSeek is off, thin, or the parse fails. */
export function fallbackNextAction(snapshot: CoachingSnapshot): {
  kind: NextActionKind;
  text: string;
} {
  const day = snapshot.dayUtc;
  if (snapshot.streak > 0 && snapshot.lastMarkUtcDay !== day) {
    return {
      kind: "streak",
      text: `Mark a reply today to keep your ${snapshot.streak}-day streak.`,
    };
  }
  if (snapshot.marksToday === 0) {
    return {
      kind: "reply",
      text: "Mark your first reply today — conversation is how the account grows.",
    };
  }
  if (snapshot.takeoffsToday === 0 && snapshot.suggestions.total === 0) {
    return {
      kind: "takeoff",
      text: "Take off once to refill Approach — you have no Suggested cards waiting.",
    };
  }
  if (snapshot.originalsToday === 0 && snapshot.marksToday >= 1) {
    return {
      kind: "original",
      text: `You marked ${snapshot.marksToday} ${snapshot.marksToday === 1 ? "reply" : "replies"} and 0 originals — post one original.`,
    };
  }
  if (snapshot.suggestions.quote > 0) {
    return {
      kind: "quote",
      text: `Work a Suggested quote — ${snapshot.suggestions.quote} ${snapshot.suggestions.quote === 1 ? "is" : "are"} waiting.`,
    };
  }
  if (snapshot.suggestions.total > 0) {
    return {
      kind: "for_you",
      text: `Clear a Suggested card — ${snapshot.suggestions.total} left in the queue.`,
    };
  }
  if (snapshot.marksToday < 2) {
    return {
      kind: "reply",
      text: `Mark one more reply today — you are at ${snapshot.marksToday}.`,
    };
  }
  if (snapshot.originalsToday < missionTarget("original_1")) {
    return {
      kind: "original",
      text: "Ship one original so the account is not only replies.",
    };
  }
  return {
    kind: "takeoff",
    text: "Daily missions are in — take off if you want more Approach.",
  };
}

export function readNextActionCache(userId: string): NextAction | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT kind, text, inputs_hash, model, updated_at
         FROM next_action_cache WHERE user_id = ?`,
    )
    .get(userId) as Record<string, unknown> | undefined;
  if (!row || !isKind(row.kind)) return null;
  const text = String(row.text ?? "").trim();
  if (!text) return null;
  return {
    kind: row.kind,
    text,
    inputsHash: String(row.inputs_hash ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    model: String(row.model ?? ""),
  };
}

export function saveNextActionCache(opts: {
  userId: string;
  action: NextAction;
}): void {
  getPlatformDb()
    .prepare(
      `INSERT INTO next_action_cache
         (user_id, kind, text, inputs_hash, model, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         kind = excluded.kind,
         text = excluded.text,
         inputs_hash = excluded.inputs_hash,
         model = excluded.model,
         updated_at = excluded.updated_at`,
    )
    .run(
      opts.userId,
      opts.action.kind,
      opts.action.text,
      opts.action.inputsHash,
      opts.action.model,
      opts.action.updatedAt,
    );
}

export async function getOrRefreshNextAction(opts: {
  userId: string;
  snapshot: CoachingSnapshot;
  inputsHash: string;
  nowMs?: number;
  chat?: ChatFn;
}): Promise<NextAction> {
  const nowMs = opts.nowMs ?? Date.now();
  const cacheHash = nextActionCacheHash(opts.inputsHash);
  const cached = readNextActionCache(opts.userId);
  if (cached && cached.inputsHash === cacheHash) return cached;

  const fallback = fallbackNextAction(opts.snapshot);
  const write = (
    kind: NextActionKind,
    text: string,
    model: string,
  ): NextAction => {
    const action: NextAction = {
      kind,
      text,
      inputsHash: cacheHash,
      updatedAt: new Date(nowMs).toISOString(),
      model,
    };
    saveNextActionCache({ userId: opts.userId, action });
    return action;
  };

  if (!opts.chat && !deepseekConfigured()) {
    return write(fallback.kind, fallback.text, "fallback");
  }

  const chat = opts.chat ?? chatCompletions;
  const result = await chat({
    purpose: "next_action",
    model: resolveFlashModel(),
    temperature: 0.2,
    messages: [
      { role: "system", content: NEXT_ACTION_SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          ...opts.snapshot,
          replyTarget: missionTarget("mark_2"),
          originalTarget: missionTarget("original_1"),
          takeoffTarget: missionTarget("takeoff_1"),
        }),
      },
    ],
  });
  if (!result.ok) {
    return write(fallback.kind, fallback.text, "fallback");
  }
  const parsed = parseNextActionJson(result.content);
  if (!parsed || !nextActionAllowed(parsed.kind, opts.snapshot)) {
    return write(fallback.kind, fallback.text, result.model);
  }
  return write(parsed.kind, parsed.text, result.model);
}
