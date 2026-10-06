import {
  lockMovedAfterNext,
  parseScoutApproachLockResponse,
  SCOUT_APPROACH_LOCK_PATH,
  type ScoutApproachLockCard,
  type DeskApproachState,
  type ScoutApproachNext,
} from "../../../shared/src/scoutApproachLock";
import type { ApproachNextRequest } from "../../../shared/src/approachNext";
import { isRecord } from "../../../shared/src/typeGuards";
import { ApiStatusError, apiRequest } from "./api";
import type { Pairing } from "./pairing";

export const OLDER_SERVER_NOTICE =
  "The X Copilot server is a version behind this extension, so Scout cards can't show here yet. Showing For You.";

export type ScoutLockRead = {
  card: ScoutApproachLockCard | null;
  next: ScoutApproachNext | null;
  state: DeskApproachState | null;
  suggestionId: string | null;
  supported: boolean;
  valid: boolean;
};

export function lockedSuggestionId(raw: unknown): string | null {
  if (!isRecord(raw) || !isRecord(raw.task) || !isRecord(raw.task.lock)) return null;
  const { phase, cardId } = raw.task.lock;
  return phase === "organic_reply" && typeof cardId === "string" && cardId ? cardId : null;
}

export function serverLacksLockRead(err: unknown): boolean {
  return err instanceof ApiStatusError && (err.status === 404 || err.status === 405);
}

export async function readScoutLock(pairing: Pairing): Promise<ScoutLockRead> {
  let raw: unknown;
  try {
    raw = await apiRequest(pairing, SCOUT_APPROACH_LOCK_PATH);
  } catch (err) {
    if (serverLacksLockRead(err)) return { card: null, next: null, state: null, suggestionId: null, supported: false, valid: false };
    throw err;
  }
  const parsed = parseScoutApproachLockResponse(raw);
  if (!parsed) return { card: null, next: null, state: null, suggestionId: null, supported: true, valid: false };
  return {
    card: parsed.card,
    next: parsed.next,
    state: parsed.state,
    suggestionId: lockedSuggestionId(raw),
    supported: true,
    valid: true,
  };
}

export const NEXT_POLL_MS = 600;
export const NEXT_POLL_FAST_MS = 150;
export const NEXT_POLL_FAST_TRIES = 4;
export const NEXT_POLL_TRIES = 13;

export function nextPollDelayMs(attempt: number): number {
  return attempt < NEXT_POLL_FAST_TRIES ? NEXT_POLL_FAST_MS : NEXT_POLL_MS;
}

export async function waitForLockChange(
  pairing: Pairing,
  request: ApproachNextRequest,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<ScoutLockRead | null> {
  for (let attempt = 0; attempt < NEXT_POLL_TRIES; attempt += 1) {
    await sleep(nextPollDelayMs(attempt));
    const lock = await readScoutLock(pairing);
    if (!lock.supported || !lock.valid) continue;
    if (lockMovedAfterNext(request, lock.card)) return lock;
    if ("forYou" in request && lock.state?.view === "collecting") return lock;
  }
  return null;
}
