import {
  FOR_YOU_KINDS,
  forYouOpenUrl,
  forYouTargetId,
  type ForYouKind,
  type ForYouSuggestion,
} from "./forYou.ts";
import { isOneOf, isRecord } from "./typeGuards.ts";

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
  state?: DeskApproachState | null,
): boolean {
  if ("forYou" in request) return card !== null || state?.suggestion !== undefined;
  return card?.id !== request.fromCardId && state?.suggestion?.id !== request.fromCardId;
}

export const APPROACH_SUGGESTION_TEXT_MAX = 2000;

export type ApproachSuggestionCard = {
  id: string;
  kind: ForYouKind;
  why: string;
  targetId: string | null;
  targetUrl: string | null;
  targetAuthor: string | null;
  openUrl: string | null;
};

export function approachSuggestionCard(row: ForYouSuggestion): ApproachSuggestionCard {
  return {
    id: row.id,
    kind: row.kind,
    why: row.why.slice(0, APPROACH_SUGGESTION_TEXT_MAX),
    targetId: forYouTargetId(row),
    targetUrl: row.targetUrl,
    targetAuthor: row.targetAuthor,
    openUrl: forYouOpenUrl(row),
  };
}

export function approachSuggestionCardId(suggestion: ApproachSuggestionCard): string | null {
  return suggestion.kind === "reply" ? suggestion.targetId : null;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseApproachSuggestionCard(raw: unknown): ApproachSuggestionCard | null {
  if (!isRecord(raw) || !isOneOf(raw.kind, FOR_YOU_KINDS)) return null;
  const id = optionalText(raw.id);
  const why = optionalText(raw.why);
  if (!id || !why) return null;
  return {
    id,
    kind: raw.kind,
    why: why.slice(0, APPROACH_SUGGESTION_TEXT_MAX),
    targetId: optionalText(raw.targetId),
    targetUrl: optionalText(raw.targetUrl),
    targetAuthor: optionalText(raw.targetAuthor),
    openUrl: optionalText(raw.openUrl),
  };
}

export const DESK_APPROACH_VIEWS = ["scout", "suggestion", "for_you", "collecting", "other"] as const;
export type DeskApproachView = (typeof DESK_APPROACH_VIEWS)[number];
export type DetectedPost = { id: string; url: string };

export type DeskApproachState = {
  view: DeskApproachView;
  detected: boolean;
  suggestion?: ApproachSuggestionCard;
  post?: DetectedPost;
};

const DETECTED_POST_ID = /^\d{1,19}$/;
const DETECTED_POST_URL = /^https:\/\/(?:www\.)?x\.com\//;

export function parseDetectedPost(raw: unknown): DetectedPost | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.url !== "string") return null;
  if (!DETECTED_POST_ID.test(raw.id) || !DETECTED_POST_URL.test(raw.url)) return null;
  return { id: raw.id, url: raw.url };
}

export function parseDeskApproachState(raw: unknown): DeskApproachState | null {
  if (!isRecord(raw) || typeof raw.detected !== "boolean") return null;
  const view = DESK_APPROACH_VIEWS.find((candidate) => candidate === raw.view);
  if (!view) return null;
  const suggestion = view === "suggestion" ? parseApproachSuggestionCard(raw.suggestion) : null;
  if (!suggestion) return { view, detected: raw.detected };
  const post = raw.detected && suggestion.kind === "post" ? parseDetectedPost(raw.post) : null;
  return post ? { view, detected: true, suggestion, post } : { view, detected: raw.detected, suggestion };
}

export function deskApproachState(opts: {
  phase: string;
  cardId: string | null;
  forYouTask: boolean;
  scoutDetected: boolean;
  suggestionDetected: boolean;
  forYouDetected: boolean;
  suggestion?: ForYouSuggestion | null;
  detectedPost?: DetectedPost | null;
}): DeskApproachState {
  if (opts.forYouTask) return { view: "for_you", detected: opts.forYouDetected };
  if (opts.phase === "scout_reply" && opts.cardId) return { view: "scout", detected: opts.scoutDetected };
  if (opts.phase === "organic_reply" && opts.cardId) {
    const suggestion = opts.suggestion?.id === opts.cardId ? approachSuggestionCard(opts.suggestion) : null;
    if (!suggestion) return { view: "suggestion", detected: opts.suggestionDetected };
    const post = opts.suggestionDetected && suggestion.kind === "post" ? opts.detectedPost ?? null : null;
    return post
      ? { view: "suggestion", detected: true, suggestion, post }
      : { view: "suggestion", detected: opts.suggestionDetected, suggestion };
  }
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
