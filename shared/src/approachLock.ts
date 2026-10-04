import { isRecord, isOneOf } from "./typeGuards";
import {
  APPROACH_SURFACES,
  DESK_PHASES,
  type ApproachLock,
} from "./deskPhase";

export const APPROACH_LOCK_STORAGE_KEY = "x-copilot-approach-lock";

export function parseApproachLock(raw: string | null): ApproachLock | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const lock = parsed;
    if (!isOneOf(lock.phase, DESK_PHASES)) return null;
    if (lock.cardId !== null && typeof lock.cardId !== "string") return null;
    if (
      lock.surface !== null &&
      !isOneOf(lock.surface, APPROACH_SURFACES)
    ) {
      return null;
    }
    return {
      phase: lock.phase,
      cardId: lock.cardId,
      surface: lock.surface,
    };
  } catch {
    return null;
  }
}
