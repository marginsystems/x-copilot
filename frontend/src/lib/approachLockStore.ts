import type { ApproachLock } from "../../../shared/src/deskPhase";
import {
  APPROACH_LOCK_STORAGE_KEY,
  parseApproachLock,
} from "../../../shared/src/approachLock";

function storageKey(userId: string): string {
  return `${APPROACH_LOCK_STORAGE_KEY}:${userId}`;
}

export function readApproachLock(
  userId: string | null | undefined,
): ApproachLock | null {
  if (!userId) return null;
  try {
    return parseApproachLock(localStorage.getItem(storageKey(userId)));
  } catch {
    return null;
  }
}

export function writeApproachLock(
  userId: string | null | undefined,
  lock: ApproachLock,
): void {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(lock));
  } catch {
    /* private mode */
  }
}
