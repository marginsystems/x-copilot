/**
 * Presentation snapshot of the locked Scout card. History pruning may remove
 * the card from inventory before the lock is restored; the retained payload
 * lets the desk keep showing the same card with its detected mark until Next.
 */
import type { ThreadCard } from "./types";
import { parseForYouSuggestion, type ForYouSuggestion } from "../lib/forYou";

export const APPROACH_RETAINED_STORAGE_KEY = "x-copilot-approach-card";
const APPROACH_RETAINED_SUGGESTION_STORAGE_KEY = "x-copilot-approach-suggestion";

function storageKey(userId: string): string {
  return `${APPROACH_RETAINED_STORAGE_KEY}:${userId}`;
}

function suggestionStorageKey(userId: string): string {
  return `${APPROACH_RETAINED_SUGGESTION_STORAGE_KEY}:${userId}`;
}

export function parseRetainedScout(raw: string | null): ThreadCard | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.author !== "string" ||
      typeof row.text !== "string" ||
      typeof row.url !== "string"
    ) {
      return null;
    }
    return row as ThreadCard;
  } catch {
    return null;
  }
}

export function readRetainedScout(
  userId: string | null | undefined,
): ThreadCard | null {
  if (!userId) return null;
  try {
    return parseRetainedScout(localStorage.getItem(storageKey(userId)));
  } catch {
    return null;
  }
}

export function writeRetainedScout(
  userId: string | null | undefined,
  card: ThreadCard,
): void {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(card));
  } catch {
    /* private mode */
  }
}

export function clearRetainedScout(userId: string | null | undefined): void {
  if (!userId) return;
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    /* private mode */
  }
}

export function readRetainedSuggestion(
  userId: string | null | undefined,
): ForYouSuggestion | null {
  if (!userId) return null;
  try {
    return parseForYouSuggestion(
      JSON.parse(localStorage.getItem(suggestionStorageKey(userId)) ?? "null"),
    );
  } catch {
    return null;
  }
}

export function writeRetainedSuggestion(
  userId: string | null | undefined,
  suggestion: ForYouSuggestion,
): void {
  if (!userId) return;
  try {
    localStorage.setItem(suggestionStorageKey(userId), JSON.stringify(suggestion));
  } catch {
    /* private mode */
  }
}

export function clearRetainedSuggestion(userId: string | null | undefined): void {
  if (!userId) return;
  try {
    localStorage.removeItem(suggestionStorageKey(userId));
  } catch {
    /* private mode */
  }
}
