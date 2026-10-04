import { isRecord } from "./typeGuards.ts";

export const SCOUT_APPROACH_LOCK_PATH = "/api/scout-approach-lock";

export type ScoutApproachLockCard = {
  id: string;
  conversationId: string | null;
  inReplyToId: string | null;
  surface: "reply" | "repost" | null;
  author: string | null;
  url: string | null;
  text: string | null;
};

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function parseScoutApproachLockCard(raw: unknown): ScoutApproachLockCard | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) return null;
  const { conversationId, inReplyToId, surface, author, url, text } = raw;
  if (!nullableString(conversationId) || !nullableString(inReplyToId)) return null;
  if (!nullableString(author) || !nullableString(url) || !nullableString(text)) return null;
  if (surface !== null && surface !== "reply" && surface !== "repost") return null;
  return { id: raw.id, conversationId, inReplyToId, surface, author, url, text };
}

export type ScoutApproachNext = { card: ScoutApproachLockCard | null };

export function parseScoutApproachNext(raw: unknown): ScoutApproachNext | null {
  if (!isRecord(raw)) return null;
  if (raw.card === null) return { card: null };
  const card = parseScoutApproachLockCard(raw.card);
  return card ? { card } : null;
}

export function lockMovedAfterNext(
  request: { fromCardId: string } | { forYou: true },
  card: { id: string } | null,
): boolean {
  return "forYou" in request ? card !== null : card?.id !== request.fromCardId;
}

export const DESK_APPROACH_VIEWS = ["scout", "suggestion", "for_you", "collecting", "other"] as const;
export type DeskApproachView = (typeof DESK_APPROACH_VIEWS)[number];
export type DeskApproachState = { view: DeskApproachView; detected: boolean };

export function parseDeskApproachState(raw: unknown): DeskApproachState | null {
  if (!isRecord(raw) || typeof raw.detected !== "boolean") return null;
  const view = DESK_APPROACH_VIEWS.find((candidate) => candidate === raw.view);
  return view ? { view, detected: raw.detected } : null;
}

export function deskApproachState(opts: {
  phase: string;
  cardId: string | null;
  forYouTask: boolean;
  scoutDetected: boolean;
  suggestionDetected: boolean;
  forYouDetected: boolean;
}): DeskApproachState {
  if (opts.forYouTask) return { view: "for_you", detected: opts.forYouDetected };
  if (opts.phase === "scout_reply" && opts.cardId) return { view: "scout", detected: opts.scoutDetected };
  if (opts.phase === "organic_reply" && opts.cardId) return { view: "suggestion", detected: opts.suggestionDetected };
  if (opts.phase === "scout_reply" || opts.phase === "done_for_now") return { view: "collecting", detected: false };
  return { view: "other", detected: false };
}

export function parseScoutApproachLockResponse(
  raw: unknown,
): { card: ScoutApproachLockCard | null; next: ScoutApproachNext | null; state: DeskApproachState | null } | null {
  if (!isRecord(raw) || raw.ok !== true) return null;
  const next = parseScoutApproachNext(raw.next);
  const state = parseDeskApproachState(raw.state);
  if (raw.card === null) return { card: null, next, state };
  const card = parseScoutApproachLockCard(raw.card);
  return card ? { card, next, state } : null;
}
