import type { ApproachTaskLock } from "./approachTaskStore.js";
import {
  advanceApproach,
  canServeApproachOriginal,
  isForYouTask,
  pickApproachSuggestion,
  type ApproachEvent,
  type ApproachGate,
  type ApproachInventory,
  type ApproachSuggestionRow,
} from "./approachPhase.js";

export type ApproachStock = {
  scoutIds: readonly string[];
  suggestions: readonly ApproachSuggestionRow[];
  interactedIds: readonly string[];
  history: ReadonlyArray<{
    threadId: string;
    conversationId?: string;
    inReplyToId?: string;
    url?: string;
  }>;
  releasedIds: readonly string[];
  gate: ApproachGate | null;
  scoutReplyDone: boolean;
  originalMission: { progress: number; target: number; completed: boolean } | null;
};

export function approachInventory(
  stock: ApproachStock,
  excludeId: string | null,
  afterForYou: boolean,
): ApproachInventory {
  const consumed = new Set([...stock.interactedIds, ...stock.releasedIds]);
  const suggestion = pickApproachSuggestion(
    stock.suggestions.filter((row) => row.id !== excludeId && !stock.releasedIds.includes(row.id)),
    {
      allowPost: canServeApproachOriginal({
        scoutReplyDone: stock.scoutReplyDone,
        afterForYou,
        originalMission: stock.originalMission,
      }),
      interactedIds: stock.interactedIds,
      history: stock.history,
      lockedId: excludeId,
    },
  );
  return {
    scoutId: stock.scoutIds.find((id) => !consumed.has(id) && id !== excludeId) ?? null,
    suggestionId: suggestion?.id ?? null,
    canPresentForYou: stock.gate === null,
    gate: stock.gate,
  };
}

export type ApproachNextStep = { lock: ApproachTaskLock; releasedIds: string[] };

export function nextApproachStep(
  stock: ApproachStock,
  lock: ApproachTaskLock,
  event: ApproachEvent = { type: "next" },
): ApproachNextStep | null {
  const next = advanceApproach(
    lock,
    event,
    approachInventory(stock, lock.cardId, isForYouTask(lock)),
  );
  if (next === lock) return null;
  const releasedIds = lock.cardId && lock.cardId !== next.cardId && !stock.releasedIds.includes(lock.cardId)
    ? [...stock.releasedIds, lock.cardId]
    : [...stock.releasedIds];
  return { lock: next, releasedIds };
}
