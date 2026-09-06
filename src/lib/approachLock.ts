import {
  DESK_PHASES,
  type ApproachLock,
  type DeskPhase,
} from "./deskPhase";

export const APPROACH_LOCK_STORAGE_KEY = "x-copilot-approach-lock";

const APPROACH_SURFACES = [
  "for_you",
  "link_x",
  "settings",
  "usage",
  "wait",
] as const;

export function parseApproachLock(raw: string | null): ApproachLock | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const lock = parsed as Record<string, unknown>;
    if (!DESK_PHASES.includes(lock.phase as DeskPhase)) return null;
    if (lock.cardId !== null && typeof lock.cardId !== "string") return null;
    if (
      lock.surface !== null &&
      !APPROACH_SURFACES.includes(
        lock.surface as (typeof APPROACH_SURFACES)[number],
      )
    ) {
      return null;
    }
    return {
      phase: lock.phase as DeskPhase,
      cardId: lock.cardId as string | null,
      surface: lock.surface as ApproachLock["surface"],
    };
  } catch {
    return null;
  }
}

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
