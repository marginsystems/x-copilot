import { getSuggestion, type ForYouSuggestion } from "../for-you/forYouStore.js";
import {
  APPROACH_SUGGESTION_TEXT_MAX,
  setDeskApproachState,
  setScoutApproachLock,
  setScoutApproachNext,
  type ApproachSuggestionCard,
  type DeskApproachState,
  type ScoutApproachLock,
} from "../scout/scoutApproachLock.js";
import { retainScoutContextForTarget } from "../scout/scoutEvidenceContext.js";
import { isRecord } from "../platform/unknownValue.js";
import { isForYouTask, type ApproachEvent } from "./approachPhase.js";
import { nextApproachStep } from "./approachSelector.js";
import { loadApproachStock, releaseCardIds, type LoadedApproachStock } from "./approachStock.js";
import { getApproachTask, setApproachTask, type ApproachTaskLock } from "./approachTaskStore.js";

export const APPROACH_NEXT_ID_MAX = 64;
export const APPROACH_NEXT_ACTIONS = ["next", "skip", "dismiss", "posted"] as const;
export const X_COMPOSE_URL = "https://x.com/intent/tweet";

export type ServerCardAction = Exclude<(typeof APPROACH_NEXT_ACTIONS)[number], "next">;

export type ServerNextRequest =
  | { fromCardId: string }
  | { fromCardId: string; action: ServerCardAction; kind: "scout" | "suggestion" }
  | { forYou: true };

export function parseServerNextRequest(raw: unknown): ServerNextRequest | null {
  if (!isRecord(raw)) return null;
  const action = raw.action === undefined
    ? "next"
    : APPROACH_NEXT_ACTIONS.find((candidate) => candidate === raw.action);
  if (!action) return null;
  if (raw.forYou === true && raw.fromCardId === undefined) {
    return action === "next" ? { forYou: true } : null;
  }
  if (typeof raw.fromCardId !== "string" || raw.forYou !== undefined) return null;
  const fromCardId = raw.fromCardId.trim();
  if (!fromCardId || fromCardId.length > APPROACH_NEXT_ID_MAX) return null;
  if (action === "next") return { fromCardId };
  if (raw.kind !== "scout" && raw.kind !== "suggestion") return null;
  if (action === "posted" && raw.kind !== "suggestion") return null;
  return { fromCardId, action, kind: raw.kind };
}

type SuggestionTarget = Pick<ForYouSuggestion, "kind" | "targetId" | "targetUrl">;

function suggestionTargetId(row: SuggestionTarget): string | null {
  return row.targetId || row.targetUrl?.match(/\/status\/(\d+)/)?.[1] || null;
}

export function serverSuggestionPostedEvent(row: SuggestionTarget): ApproachEvent {
  return row.kind === "reply" && suggestionTargetId(row) ? { type: "next" } : { type: "posted" };
}

export function serverNextEvent(request: ServerNextRequest, suggestion: SuggestionTarget | null = null): ApproachEvent {
  if (!("action" in request) || !request.action) return { type: "next" };
  if (request.action === "posted" && suggestion) return serverSuggestionPostedEvent(suggestion);
  return { type: request.action };
}

export function serverSuggestionOpenUrl(row: SuggestionTarget): string | null {
  if (row.kind === "post") return X_COMPOSE_URL;
  if (row.targetUrl && /^https?:\/\//i.test(row.targetUrl)) return row.targetUrl;
  if (!row.targetId || !/^\d+$/.test(row.targetId)) return null;
  if (row.kind === "reply") {
    const params = new URLSearchParams({ in_reply_to: row.targetId });
    return `${X_COMPOSE_URL}?${params.toString()}`;
  }
  return `https://x.com/i/status/${row.targetId}`;
}

export function serverSuggestionCard(
  row: Pick<ForYouSuggestion, "id" | "kind" | "why" | "targetId" | "targetUrl" | "targetAuthor">,
): ApproachSuggestionCard {
  return {
    id: row.id,
    kind: row.kind,
    why: row.why.slice(0, APPROACH_SUGGESTION_TEXT_MAX),
    targetId: suggestionTargetId(row),
    targetUrl: row.targetUrl,
    targetAuthor: row.targetAuthor,
    openUrl: serverSuggestionOpenUrl(row),
  };
}

export function serverNextApplies(lock: ApproachTaskLock, request: ServerNextRequest): boolean {
  if ("forYou" in request) return isForYouTask(lock);
  if (lock.cardId !== request.fromCardId) return false;
  if ("action" in request && request.action) return lock.phase === "scout_reply" || lock.phase === "organic_reply";
  return lock.phase === "scout_reply";
}

function remoteNextCanApply(lock: ApproachTaskLock): boolean {
  return isForYouTask(lock) || (lock.phase === "scout_reply" && lock.cardId !== null);
}

export function publishedCardFor(lock: ApproachTaskLock, loaded: LoadedApproachStock): ScoutApproachLock | null {
  if (lock.phase === "scout_reply" && lock.cardId) {
    const card = loaded.scoutCards.find((row) => row.id === lock.cardId);
    return card ? { ...card, surface: "reply" } : null;
  }
  if (lock.phase === "organic_reply" && lock.cardId) {
    const suggestion = loaded.suggestions.find((row) => row.id === lock.cardId);
    if (!suggestion || suggestion.kind !== "reply") return null;
    const targetId = suggestionTargetId(suggestion);
    if (!targetId) return null;
    return {
      id: targetId,
      conversationId: targetId,
      inReplyToId: targetId,
      surface: "reply",
      author: suggestion.targetAuthor,
      url: suggestion.targetUrl,
      text: null,
    };
  }
  return null;
}

export function publishedStateFor(lock: ApproachTaskLock, loaded?: LoadedApproachStock): DeskApproachState | null {
  if (isForYouTask(lock)) return null;
  if (lock.phase === "scout_reply" && lock.cardId) return { view: "scout", detected: false };
  if (lock.phase === "organic_reply" && lock.cardId) {
    const row = loaded?.suggestions.find((candidate) => candidate.id === lock.cardId);
    return row
      ? { view: "suggestion", detected: false, suggestion: serverSuggestionCard(row) }
      : { view: "suggestion", detected: false };
  }
  if (lock.phase === "scout_reply" || lock.phase === "done_for_now") return { view: "collecting", detected: false };
  return { view: "other", detected: false };
}

export async function advanceApproachOnServer(
  userId: string,
  request: ServerNextRequest,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const task = getApproachTask(userId);
  if (!task) return false;
  if (!serverNextApplies(task.lock, request)) return false;
  const loaded = await loadApproachStock(userId, nowMs);
  if (!loaded) return false;
  const posted = "action" in request && request.action === "posted" && task.lock.cardId
    ? getSuggestion(task.lock.cardId, userId)
    : null;
  const step = nextApproachStep(loaded.stock, task.lock, serverNextEvent(request, posted));
  if (!step) return false;

  if (task.lock.cardId && step.releasedIds.includes(task.lock.cardId)) {
    releaseCardIds(userId, [task.lock.cardId], nowMs);
  }
  setApproachTask(userId, step.lock, "server", nowMs);
  const card = publishedCardFor(step.lock, loaded);
  setScoutApproachLock(userId, card);
  const following = remoteNextCanApply(step.lock)
    ? nextApproachStep({ ...loaded.stock, releasedIds: step.releasedIds }, step.lock)
    : null;
  setScoutApproachNext(
    userId,
    following && following.lock.phase !== "organic_reply" ? { card: publishedCardFor(following.lock, loaded) } : null,
  );
  setDeskApproachState(userId, publishedStateFor(step.lock, loaded));
  if (card) {
    try {
      await retainScoutContextForTarget({
        userId,
        targetId: card.id,
        conversationId: card.conversationId,
        inReplyToId: card.inReplyToId,
        fallbackAuthor: card.author,
        fallbackText: card.text,
        source: "lock",
      });
    } catch (err) {
      console.warn("server approach next context retain soft-fail:", err);
    }
  }
  return true;
}
