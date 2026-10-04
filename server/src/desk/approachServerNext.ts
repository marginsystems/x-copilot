import {
  setDeskApproachState,
  setScoutApproachLock,
  setScoutApproachNext,
  type DeskApproachState,
  type ScoutApproachLock,
} from "../scout/scoutApproachLock.js";
import { retainScoutContextForTarget } from "../scout/scoutEvidenceContext.js";
import { isForYouTask } from "./approachPhase.js";
import { nextApproachStep } from "./approachSelector.js";
import { loadApproachStock, releaseCardIds, type LoadedApproachStock } from "./approachStock.js";
import { getApproachTask, setApproachTask, type ApproachTaskLock } from "./approachTaskStore.js";

export type ServerNextRequest = { fromCardId: string } | { forYou: true };

export function serverNextApplies(lock: ApproachTaskLock, request: ServerNextRequest): boolean {
  if ("forYou" in request) return isForYouTask(lock);
  return lock.phase === "scout_reply" && lock.cardId === request.fromCardId;
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
    const targetId = suggestion.targetId || suggestion.targetUrl?.match(/\/status\/(\d+)/)?.[1] || null;
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

export function publishedStateFor(lock: ApproachTaskLock): DeskApproachState | null {
  if (isForYouTask(lock)) return null;
  if (lock.phase === "scout_reply" && lock.cardId) return { view: "scout", detected: false };
  if (lock.phase === "organic_reply" && lock.cardId) return { view: "suggestion", detected: false };
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
  const step = nextApproachStep(loaded.stock, task.lock);
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
  setScoutApproachNext(userId, following ? { card: publishedCardFor(following.lock, loaded) } : null);
  setDeskApproachState(userId, publishedStateFor(step.lock));
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
