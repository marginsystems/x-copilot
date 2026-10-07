import { getSuggestion } from "../for-you/forYouStore.js";
import {
  getDeskApproachState,
  setDeskApproachState,
  type ApproachSuggestionCard,
} from "../scout/scoutApproachLock.js";
import { publishScoutApproachLockChanged } from "../scout/scoutApproachLockEvents.js";
import { isForYouTask } from "./approachPhase.js";
import { serverSuggestionCard } from "./approachServerNext.js";
import { getApproachTask } from "./approachTaskStore.js";

export type ConfirmedOwnPost = { id: string; kind: string; postedAt: string; url: string };

export type WaitingOriginal = { suggestion: ApproachSuggestionCard; since: string };

export function waitingOriginalCard(userId: string): WaitingOriginal | null {
  const task = getApproachTask(userId);
  if (task?.lock.phase !== "organic_reply" || !task.lock.cardId) return null;
  const row = getSuggestion(task.lock.cardId, userId);
  if (!row || row.kind !== "post" || row.status !== "suggested") return null;
  const state = getDeskApproachState(userId);
  if (state?.view === "suggestion" && state.detected && state.suggestion?.id === row.id) return null;
  const suggestion = state?.suggestion?.id === row.id ? state.suggestion : serverSuggestionCard(row);
  return { suggestion, since: task.updatedAt };
}

export function detectOriginalForApproach(userId: string, post: ConfirmedOwnPost): boolean {
  if (post.kind !== "original") return false;
  const waiting = waitingOriginalCard(userId);
  if (!waiting) return false;
  const postedMs = Date.parse(post.postedAt);
  if (!Number.isFinite(postedMs) || postedMs <= Date.parse(waiting.since)) return false;
  setDeskApproachState(userId, {
    view: "suggestion",
    detected: true,
    suggestion: waiting.suggestion,
    post: { id: post.id, url: post.url },
  });
  publishScoutApproachLockChanged(userId);
  return true;
}

export function waitingForYouSince(userId: string): string | null {
  const task = getApproachTask(userId);
  if (!task || !isForYouTask(task.lock)) return null;
  const state = getDeskApproachState(userId);
  if (state?.view === "for_you" && state.detected) return null;
  return task.updatedAt;
}

export function detectForYouForApproach(userId: string, post: ConfirmedOwnPost): boolean {
  const since = waitingForYouSince(userId);
  if (!since) return false;
  const postedMs = Date.parse(post.postedAt);
  if (!Number.isFinite(postedMs) || postedMs <= Date.parse(since)) return false;
  setDeskApproachState(userId, { view: "for_you", detected: true });
  publishScoutApproachLockChanged(userId);
  return true;
}

export function detectOwnPostForApproach(userId: string, post: ConfirmedOwnPost): boolean {
  return detectForYouForApproach(userId, post) || detectOriginalForApproach(userId, post);
}
