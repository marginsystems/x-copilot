import { createHash, randomBytes } from "node:crypto";
import { getPlatformDb } from "../db.js";
import { lookupInteractionMemoryReceipts } from "../memory/interactionMemoryReceipt.js";
import { COOLDOWN_MS } from "./interactionCooldown.js";
import {
  listInteractionAts,
  listInteractionPageKeys,
  readInteractionVersion,
  type InteractionPageKey,
} from "./interactionStore.js";

type CooldownTransitions = { version: number; times: number[] };

let processEpoch = randomBytes(8).toString("hex");
let transitionsByDb = new WeakMap<object, Map<string, CooldownTransitions>>();

export function resetInteractedVersionForTests(): void {
  processEpoch = randomBytes(8).toString("hex");
  transitionsByDb = new WeakMap();
}

export function cooldownTransitionTimes(ats: readonly string[]): number[] {
  const times: number[] = [];
  for (const at of ats) {
    const ms = Date.parse(at);
    if (!Number.isFinite(ms)) continue;
    times.push(ms, ms + COOLDOWN_MS);
  }
  return times.sort((a, b) => a - b);
}

export function countTransitionsAtOrBefore(
  sorted: readonly number[],
  nowMs: number,
): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! <= nowMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function readUserSnapshot(
  userId: string,
  page: number,
): { version: number; transitions: number[]; pageKeys: InteractionPageKey[] } {
  const db = getPlatformDb();
  return db.transaction(() => {
    const version = readInteractionVersion(userId);
    let byUser = transitionsByDb.get(db);
    if (!byUser) {
      byUser = new Map();
      transitionsByDb.set(db, byUser);
    }
    let cached = byUser.get(userId);
    if (cached?.version !== version) {
      cached = { version, times: cooldownTransitionTimes(listInteractionAts(userId)) };
      byUser.set(userId, cached);
    }
    return {
      version,
      transitions: cached.times,
      pageKeys: listInteractionPageKeys(userId, page),
    };
  })();
}

export async function interactedEtag(opts: {
  userId: string | undefined;
  page: number;
  includeRetained: boolean;
  nowMs: number;
}): Promise<string> {
  const parts: string[] = [
    processEpoch,
    opts.userId ?? "",
    String(opts.page),
    opts.includeRetained ? "retained" : "",
  ];
  if (opts.userId) {
    const snapshot = readUserSnapshot(opts.userId, opts.page);
    const receipts = snapshot.pageKeys.length
      ? await lookupInteractionMemoryReceipts({
          userId: opts.userId,
          interactions: snapshot.pageKeys,
        }).catch(() => snapshot.pageKeys.map(() => "unavailable"))
      : [];
    parts.push(
      String(snapshot.version),
      String(countTransitionsAtOrBefore(snapshot.transitions, opts.nowMs)),
      receipts.join(","),
    );
  }
  const hash = createHash("sha1");
  for (const part of parts) hash.update(part).update("\0");
  return `"${hash.digest("base64url")}"`;
}
