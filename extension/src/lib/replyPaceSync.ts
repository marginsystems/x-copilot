import { browser } from "wxt/browser";
import { coachingPath, parseCoachingPayload, type CoachingState } from "../../../shared/src/coaching";
import { replyPaceSeedIso } from "../../../shared/src/replyPace";
import { apiRequest } from "./api";
import type { Pairing } from "./pairing";
import { parseReplyPaceAt, REPLY_PACE_AT_KEY } from "./replySeen";

export const SAME_REPLY_MS = 5_000;
export const REPLY_PACE_SYNC_GAP_MS = 5_000;

export function newestReplyMs(replyAt: readonly string[] | undefined): number | null {
  let newest: number | null = null;
  for (const at of replyAt ?? []) {
    const ms = Date.parse(at);
    if (Number.isFinite(ms) && (newest === null || ms > newest)) newest = ms;
  }
  return newest;
}

export function newestReplyIso(coaching: Pick<CoachingState, "replyAt" | "ownActivity"> | null): string | null {
  return replyPaceSeedIso({ replyAtIso: coaching?.replyAt?.[0] ?? null, ownActivity: coaching?.ownActivity }) ?? null;
}

export function paceReplies(data: { replyAt: readonly string[]; paceReplyAt?: string | null }): readonly string[] {
  return data.paceReplyAt ? [data.paceReplyAt, ...data.replyAt] : data.replyAt;
}

export function mergeReplyPaceAt(stored: number | null, server: number | null): number | null {
  if (server === null) return stored;
  if (stored === null) return server;
  return server >= stored - SAME_REPLY_MS ? server : stored;
}

export async function storeServerReplyPace(replyAt: readonly string[] | undefined): Promise<void> {
  const server = newestReplyMs(replyAt);
  if (server === null) return;
  const stored = parseReplyPaceAt((await browser.storage.local.get(REPLY_PACE_AT_KEY))[REPLY_PACE_AT_KEY]);
  const next = mergeReplyPaceAt(stored, server);
  if (next !== null && next !== stored) await browser.storage.local.set({ [REPLY_PACE_AT_KEY]: next });
}

let syncedAtMs = -Infinity;

export async function syncReplyPace(pairing: Pairing | null, nowMs: number = Date.now()): Promise<boolean> {
  if (!pairing) return false;
  if (nowMs - syncedAtMs < REPLY_PACE_SYNC_GAP_MS) return true;
  syncedAtMs = nowMs;
  const coaching = parseCoachingPayload(await apiRequest(pairing, coachingPath({ lite: true })));
  const newest = newestReplyIso(coaching);
  await storeServerReplyPace(newest ? [newest] : []);
  return true;
}

export function resetReplyPaceSync(): void {
  syncedAtMs = -Infinity;
}

export function onlyReplyPaceChanged(changes: Record<string, unknown>): boolean {
  const keys = Object.keys(changes);
  return keys.length > 0 && keys.every((key) => key === REPLY_PACE_AT_KEY);
}
