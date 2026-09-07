export const DESK_PHASES = [
  "needs_onboarding",
  "hold",
  "scout_reply",
  "organic_reply",
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

/** A missing prerequisite. Scout cooldown, grounding, and credits are not gates. */
export type ApproachGate = "link_x" | "settings";

export type ApproachLock = {
  phase: DeskPhase;
  /** Inventory identity. For You and gate cards do not need one. */
  cardId: string | null;
  /**
   * `usage` and `wait` are legacy persisted surfaces. Boot normalization turns
   * them into the For You task; they are never written again.
   */
  surface: "for_you" | "link_x" | "settings" | "usage" | "wait" | null;
};

export type ApproachInventory = {
  scoutId: string | null;
  suggestionId: string | null;
  canPresentForYou: boolean;
  /** Missing prerequisite when For You cannot present. */
  gate?: ApproachGate | null;
  /** Remaining reply minute. Next honors it; Bypass is the exception. */
  paceLocked?: boolean;
};

export type ApproachEvent =
  | { type: "next" }
  | { type: "skip" }
  | { type: "dismiss" }
  | { type: "mark" }
  | { type: "bypass" }
  | { type: "posted" };

export function approachGate(opts: {
  needsXLink: boolean;
  hasAgenda: boolean;
}): ApproachGate | null {
  if (opts.needsXLink) return "link_x";
  if (!opts.hasAgenda) return "settings";
  return null;
}

const FOR_YOU_LOCK: ApproachLock = {
  phase: "silent_refuel",
  cardId: null,
  surface: "for_you",
};

const HOLD_LOCK: ApproachLock = {
  phase: "hold",
  cardId: null,
  surface: "for_you",
};

/** The real x.com/home wait, whether or not the reply minute is running. */
export function isForYouTask(lock: ApproachLock): boolean {
  return (
    lock.phase === "hold" ||
    (lock.phase === "silent_refuel" && lock.surface === "for_you")
  );
}

function isInventoryTask(lock: ApproachLock): boolean {
  return (
    (lock.phase === "scout_reply" || lock.phase === "organic_reply") &&
    lock.cardId !== null
  );
}

function nextInventoryCard(
  inventory: ApproachInventory,
  excludeId: string | null,
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
  if (inventory.canPresentForYou) return { ...FOR_YOU_LOCK };
  if (inventory.gate) {
    return { phase: "silent_refuel", cardId: null, surface: inventory.gate };
  }
  return { phase: "done_for_now", cardId: null, surface: null };
}

/** First paint is the only inventory-driven choice. The returned card is locked. */
export function initialApproachLock(opts: {
  forYouHeld: boolean;
  paceLocked: boolean;
  scoutId: string | null;
  fallback: "for_you" | ApproachGate;
}): ApproachLock {
  if (opts.forYouHeld) return { ...FOR_YOU_LOCK };
  if (opts.paceLocked) return { ...HOLD_LOCK };
  if (opts.scoutId) {
    return { phase: "scout_reply", cardId: opts.scoutId, surface: null };
  }
  return { phase: "silent_refuel", cardId: null, surface: opts.fallback };
}

/**
 * Pre-paint migration and gate reconciliation. Returns the same object when the
 * lock is a valid active task so callers can compare by identity. Inventory
 * arrivals never reach this path; only a restored lock or a changed
 * prerequisite does.
 */
export function normalizeApproachLock(
  lock: ApproachLock,
  ctx: {
    gate: ApproachGate | null;
    scoutId: string | null;
    suggestionId?: string | null;
    canOpenForYou: boolean;
  },
): ApproachLock {
  const fresh = () =>
    nextInventoryCard(
      {
        scoutId: ctx.scoutId,
        suggestionId: ctx.suggestionId ?? null,
        canPresentForYou: ctx.canOpenForYou,
        gate: ctx.gate,
      },
      null,
    );
  if (isInventoryTask(lock)) return lock;
  if (ctx.gate) {
    if (lock.phase === "silent_refuel" && lock.surface === ctx.gate) {
      return lock;
    }
    return { phase: "silent_refuel", cardId: null, surface: ctx.gate };
  }
  if (lock.phase === "hold") {
    return lock.surface === "for_you" && lock.cardId === null
      ? lock
      : { ...HOLD_LOCK };
  }
  if (lock.phase === "silent_refuel" && lock.surface === "for_you") {
    return lock.cardId === null ? lock : { ...FOR_YOU_LOCK };
  }
  return fresh();
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
  if (locked.phase === "done_for_now") {
    return nextInventoryCard(inventory, null);
  }
  if (isForYouTask(locked)) {
    if (event.type === "next") {
      if (inventory.paceLocked) return locked;
      return nextInventoryCard(inventory, null);
    }
    if (event.type === "bypass") return nextInventoryCard(inventory, null);
  }
  if (locked.phase === "scout_reply") {
    if (event.type === "next") {
      if (inventory.paceLocked) return { ...HOLD_LOCK };
      return nextInventoryCard(inventory, locked.cardId);
    }
    if (event.type === "mark") return { ...HOLD_LOCK };
    if (event.type === "skip" || event.type === "dismiss") {
      return nextInventoryCard(inventory, locked.cardId);
    }
  }
  if (locked.phase === "organic_reply") {
    if (
      event.type === "posted" ||
      event.type === "skip" ||
      event.type === "dismiss"
    ) {
      return nextInventoryCard(inventory, locked.cardId);
    }
  }
  return locked;
}

/** Approach tab badge: the card on the desk (0 or 1). */
export function approachTabLiveCount(opts: {
  phase: DeskPhase;
  hasScoutCard: boolean;
  hasSuggestion: boolean;
  /** A real For You task is presented, whatever phase carries it. */
  holdForYouTask?: boolean;
  refillState?: "queued" | "waiting" | "flying" | "landed" | "terminal_empty";
}): number {
  if (opts.holdForYouTask) return 1;
  if (opts.phase === "scout_reply" && opts.hasScoutCard) return 1;
  if (opts.phase === "organic_reply" && opts.hasSuggestion) {
    return 1;
  }
  if (
    opts.phase === "done_for_now" &&
    (opts.refillState === "queued" ||
      opts.refillState === "waiting" ||
      opts.refillState === "flying")
  ) {
    return 1;
  }
  return 0;
}
