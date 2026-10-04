import type { ApproachTaskLock } from "./approachTaskStore.js";

export type ApproachGate = "link_x" | "settings";

export type ApproachInventory = {
  scoutId: string | null;
  suggestionId: string | null;
  canPresentForYou: boolean;
  gate?: ApproachGate | null;
};

export type ApproachEvent =
  | { type: "next" }
  | { type: "skip" }
  | { type: "dismiss" }
  | { type: "mark" }
  | { type: "bypass" }
  | { type: "posted" };

const FOR_YOU_LOCK: ApproachTaskLock = {
  phase: "silent_refuel",
  cardId: null,
  surface: "for_you",
};

export function isForYouTask(lock: ApproachTaskLock): boolean {
  return (
    lock.phase === "hold" ||
    (lock.phase === "silent_refuel" && lock.surface === "for_you")
  );
}

function nextScoutCard(scoutId: string | null, excludeId: string | null): ApproachTaskLock {
  return {
    phase: "scout_reply",
    cardId: scoutId !== excludeId ? scoutId : null,
    surface: null,
  };
}

function nextInventoryCard(
  inventory: ApproachInventory,
  excludeId: string | null,
  previousPhase: ApproachTaskLock["phase"] | null = null,
  preferSuggestion = false,
): ApproachTaskLock {
  const scout =
    inventory.scoutId && inventory.scoutId !== excludeId
      ? { phase: "scout_reply", cardId: inventory.scoutId, surface: null } as const
      : null;
  const suggestion =
    inventory.suggestionId && inventory.suggestionId !== excludeId
      ? {
          phase: "organic_reply",
          cardId: inventory.suggestionId,
          surface: null,
        } as const
      : null;
  if (previousPhase === "scout_reply" && suggestion) return suggestion;
  if (previousPhase === "organic_reply" && scout) return scout;
  if (previousPhase === "organic_reply" && preferSuggestion && suggestion) {
    return suggestion;
  }
  if (previousPhase === "scout_reply" && inventory.canPresentForYou) {
    return { ...FOR_YOU_LOCK };
  }
  if (previousPhase === "organic_reply" && inventory.canPresentForYou) {
    return { ...FOR_YOU_LOCK };
  }
  if (scout) {
    return scout;
  }
  if (suggestion) return suggestion;
  if (previousPhase === "hold" || previousPhase === "silent_refuel") {
    return { phase: "done_for_now", cardId: null, surface: null };
  }
  if (inventory.canPresentForYou) return { ...FOR_YOU_LOCK };
  if (inventory.gate) {
    return { phase: "silent_refuel", cardId: null, surface: inventory.gate };
  }
  return { phase: "done_for_now", cardId: null, surface: null };
}

export function advanceApproach(
  locked: ApproachTaskLock,
  event: ApproachEvent,
  inventory: ApproachInventory,
): ApproachTaskLock {
  if (locked.phase === "done_for_now") {
    if (!inventory.scoutId && !inventory.suggestionId) return locked;
    return nextInventoryCard({ ...inventory, canPresentForYou: false }, null);
  }
  if (isForYouTask(locked)) {
    if (event.type === "next") {
      return nextInventoryCard(inventory, null, locked.phase);
    }
    if (event.type === "bypass") {
      return nextInventoryCard(inventory, null, locked.phase);
    }
  }
  if (locked.phase === "scout_reply") {
    if (event.type === "next") {
      if (locked.cardId === null) {
        return inventory.scoutId ? nextScoutCard(inventory.scoutId, null) : locked;
      }
      return nextInventoryCard(inventory, locked.cardId, locked.phase);
    }
    if (event.type === "mark") {
      return inventory.scoutId === null
        ? { phase: "scout_reply", cardId: null, surface: null }
        : locked;
    }
    if (event.type === "skip" || event.type === "dismiss") {
      return nextScoutCard(inventory.scoutId, locked.cardId);
    }
  }
  if (locked.phase === "organic_reply") {
    if (event.type === "next") {
      return nextInventoryCard(inventory, locked.cardId, locked.phase, true);
    }
    if (event.type === "posted" || event.type === "skip" || event.type === "dismiss") {
      return nextInventoryCard(inventory, locked.cardId, locked.phase);
    }
  }
  return locked;
}

export type ApproachSuggestionRow = {
  id: string;
  kind: "post" | "quote" | "repost" | "reply";
  targetId: string | null;
  targetUrl: string | null;
};

export function canServeApproachOriginal(opts: {
  scoutReplyDone: boolean;
  afterForYou?: boolean;
  originalMission?: { progress: number; target: number; completed: boolean } | null;
}): boolean {
  if (!opts.scoutReplyDone && !opts.afterForYou) return false;
  const mission = opts.originalMission;
  if (!mission || mission.completed) return false;
  return mission.progress < mission.target;
}

function isPacedSuggestion(row: ApproachSuggestionRow): boolean {
  return row.kind === "reply" || row.kind === "quote" || row.kind === "repost";
}

function targetUrlId(url: string | null): string | null {
  return url?.match(/\/status\/(\d+)/)?.[1] ?? null;
}

export function pickApproachSuggestion<Row extends ApproachSuggestionRow>(
  rows: Row[],
  opts?: {
    allowPost?: boolean;
    interactedIds?: Iterable<string>;
    history?: ReadonlyArray<{
      threadId: string;
      conversationId?: string;
      inReplyToId?: string;
      url?: string;
    }>;
    lockedId?: string | null;
  },
): Row | null {
  const blockedIds = new Set(opts?.interactedIds ?? []);
  const blockedUrls = new Set<string>();
  for (const row of opts?.history ?? []) {
    blockedIds.add(row.threadId);
    if (row.conversationId) blockedIds.add(row.conversationId);
    if (row.inReplyToId) blockedIds.add(row.inReplyToId);
    if (row.url) blockedUrls.add(row.url);
  }
  const paced = rows.find((row) => {
    if (!isPacedSuggestion(row)) return false;
    if (row.id === opts?.lockedId) return true;
    const urlId = targetUrlId(row.targetUrl);
    return !(
      (row.targetId && blockedIds.has(row.targetId)) ||
      (row.targetUrl && blockedUrls.has(row.targetUrl)) ||
      (urlId && blockedIds.has(urlId))
    );
  });
  if (paced) return paced;
  if (opts?.allowPost) {
    return rows.find((row) => row.kind === "post") ?? null;
  }
  return null;
}
