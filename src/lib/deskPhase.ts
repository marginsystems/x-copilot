export const DESK_PHASES = [
  "needs_onboarding",
  "hold",
  "scout_reply",
  "organic_reply",
  "fork",
  "original",
  "silent_refuel",
  "done_for_now",
] as const;

export type DeskPhase = (typeof DESK_PHASES)[number];

export type DeskBeats = {
  scoutReplyDone: boolean;
  organicReplyDone: boolean;
  /** null = no fork pick yet */
  forkChoice: "original" | "reply" | null;
  forkDone: boolean;
};

export function emptyDeskBeats(): DeskBeats {
  return {
    scoutReplyDone: false,
    organicReplyDone: false,
    forkChoice: null,
    forkDone: false,
  };
}

export type ApproachLock = {
  phase: DeskPhase;
  /** Inventory identity. For You and gate cards do not need one. */
  cardId: string | null;
  surface: "for_you" | "link_x" | "settings" | "usage" | "wait" | null;
};

export type ApproachInventory = {
  scoutId: string | null;
  suggestionId: string | null;
  canPresentForYou: boolean;
};

export type ApproachEvent =
  | { type: "next" }
  | { type: "skip" }
  | { type: "dismiss" }
  | { type: "mark" }
  | { type: "bypass" }
  | { type: "fork"; choice: "original" | "reply" }
  | { type: "posted" };

function nextInventoryCard(
  inventory: ApproachInventory,
  excludeId: string | null,
  allowForYou = true,
): ApproachLock {
  if (inventory.scoutId && inventory.scoutId !== excludeId) {
    return { phase: "scout_reply", cardId: inventory.scoutId, surface: null };
  }
  if (inventory.suggestionId && inventory.suggestionId !== excludeId) {
    return {
      phase: "organic_reply",
      cardId: inventory.suggestionId,
      surface: null,
    };
  }
  if (allowForYou && inventory.canPresentForYou) {
    return { phase: "silent_refuel", cardId: null, surface: "for_you" };
  }
  return { phase: "done_for_now", cardId: null, surface: null };
}

/** First paint is the only inventory-driven choice. The returned card is locked. */
export function initialApproachLock(opts: {
  forYouHeld: boolean;
  paceLocked: boolean;
  scoutId: string | null;
  fallback: "for_you" | "link_x" | "settings" | "usage" | "wait";
}): ApproachLock {
  if (opts.forYouHeld) {
    return { phase: "silent_refuel", cardId: null, surface: "for_you" };
  }
  if (opts.paceLocked) {
    return { phase: "hold", cardId: null, surface: "for_you" };
  }
  if (opts.scoutId) {
    return { phase: "scout_reply", cardId: opts.scoutId, surface: null };
  }
  return { phase: "silent_refuel", cardId: null, surface: opts.fallback };
}

/**
 * The sole unlock point for Approach. Inventory and async state never call it.
 * The caller supplies one snapshot; the chosen result is locked until another
 * legal card button is pressed.
 */
export function advanceApproach(
  locked: ApproachLock,
  event: ApproachEvent,
  inventory: ApproachInventory,
): ApproachLock {
  if (
    (locked.phase === "silent_refuel" || locked.phase === "hold") &&
    event.type === "next"
  ) {
    return nextInventoryCard(inventory, null, false);
  }
  if (locked.phase === "hold" && event.type === "bypass") {
    return nextInventoryCard(inventory, null);
  }
  if (locked.phase === "scout_reply") {
    if (event.type === "mark") {
      return { phase: "hold", cardId: null, surface: "for_you" };
    }
    if (event.type === "skip" || event.type === "dismiss") {
      return nextInventoryCard(inventory, locked.cardId);
    }
  }
  if (locked.phase === "organic_reply") {
    if (event.type === "posted") {
      return { phase: "fork", cardId: null, surface: null };
    }
    if (event.type === "skip" || event.type === "dismiss") {
      return nextInventoryCard(inventory, locked.cardId);
    }
  }
  if (locked.phase === "fork" && event.type === "fork") {
    return event.choice === "original"
      ? { phase: "original", cardId: null, surface: null }
      : nextInventoryCard(inventory, null);
  }
  if (locked.phase === "original" && event.type === "posted") {
    return nextInventoryCard(inventory, null);
  }
  return locked;
}

/** Approach tab badge: the card on the desk (0 or 1). */
export function approachTabLiveCount(opts: {
  phase: DeskPhase;
  hasScoutCard: boolean;
  hasSuggestion: boolean;
  holdForYouTask?: boolean;
}): number {
  if (
    opts.holdForYouTask &&
    (opts.phase === "silent_refuel" || opts.phase === "hold")
  ) {
    return 1;
  }
  if (opts.phase === "scout_reply" && opts.hasScoutCard) return 1;
  if (opts.phase === "organic_reply" && opts.hasSuggestion) {
    return 1;
  }
  if (opts.phase === "original" && opts.hasSuggestion) return 1;
  return 0;
}
