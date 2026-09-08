/**
 * The Approach task machine. One locked card, its For You wait, the refill arm,
 * and the detector it owns. Inventory arrivals never release a task; only a
 * card button, a cleared gate, or pre-paint normalization changes the lock.
 */
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AuthSessionUser } from "../auth/types";
import { AGENDA_MIN_CHARS } from "../lib/agendaPersist";
import {
  canServeApproachOriginal,
  pickApproachSuggestion,
} from "../lib/approachCard";
import { readApproachLock, writeApproachLock } from "../lib/approachLock";
import {
  approachTaskKey,
  reconcileApproachGate,
  restoreApproachTask,
  shouldAutoAdvanceIdle,
  transitionApproachTask,
  type ApproachNormalizeContext,
  type ApproachTaskState,
} from "../lib/approachTask";
import type { CoachingState } from "../lib/coaching";
import { deskNeedsXLink } from "../lib/deskGate";
import {
  approachGate,
  approachTabLiveCount,
  isForYouTask,
  type ApproachEvent,
  type ApproachInventory,
} from "../lib/deskPhase";
import {
  clearScoutTakeoffTried,
  eligibleScoutCards,
  markScoutTakeoffTried,
  readScoutTakeoffTried,
  shouldArmScoutOnBoot,
  shouldArmScoutRefill,
  shouldBackgroundScout,
} from "../lib/deskRefuel";
import type { ForYouSuggestion } from "../lib/forYou";
import {
  clearForYouWait,
  forYouWaitDetected,
  readForYouWait,
  settleForYouWait,
  writeForYouWait,
} from "../lib/forYouTask";
import { vanishEvent } from "../lib/vanishEvent";
import { apiFetch } from "../lib/apiBase";
import { presentApproach, type ApproachCardInput } from "./approachPresenter";
import {
  clearRetainedScout,
  readRetainedScout,
  writeRetainedScout,
} from "./approachRetained";
import { pickApproachScout } from "./approachScout";
import type {
  DismissalHistoryEntry,
  InteractionHistoryEntry,
  ThreadCard,
} from "./types";
import { useDeskRowExit } from "./useDeskRowExit";
import { useReplyPace } from "./useReplyPace";
import { watchDeskThreads } from "./watch";

export type UseApproachTaskOpts = {
  authUser: AuthSessionUser | null;
  deskBootReady: boolean;
  agendaReady: boolean;
  agenda: string;
  curatedThreads: ThreadCard[];
  forYouSuggestions: ForYouSuggestion[];
  coaching?: CoachingState | null;
  interactedIds: Set<string>;
  interactedHistory: InteractionHistoryEntry[];
  interactedHydrated: boolean;
  dismissedHistory: DismissalHistoryEntry[];
  markThread: ThreadCard | null;
  dismissThread: ThreadCard | null;
  searching: boolean;
  grounded: boolean;
  searchCooldownRemaining: number;
  setExpandedId: Dispatch<SetStateAction<string | null>>;
  actForYou: (
    id: string,
    action: "done" | "skip" | "dismiss",
  ) => Promise<boolean>;
  onSearch: () => void;
  onMark: (thread: ThreadCard) => void;
  onSkip: (thread: ThreadCard) => void | Promise<boolean>;
  onDismiss: (thread: ThreadCard) => void;
  onRefreshCoaching: (opts?: { lite?: boolean }) => void | Promise<void>;
  onHydrateInteracted: (preservedId?: string | null) => void | Promise<void>;
};

export function useApproachTask(opts: UseApproachTaskOpts) {
  const {
    authUser,
    deskBootReady,
    agendaReady,
    agenda,
    curatedThreads,
    forYouSuggestions,
    coaching,
    interactedIds,
    interactedHistory,
    interactedHydrated,
    dismissedHistory,
    markThread,
    dismissThread,
    searching,
    grounded,
    searchCooldownRemaining,
    setExpandedId,
    actForYou,
    onSearch,
    onMark,
    onSkip,
    onDismiss,
    onRefreshCoaching,
    onHydrateInteracted,
  } = opts;
  const pace = useReplyPace(coaching?.replyAt?.[0]);
  const { exitingIds, beginExit, clearGone } = useDeskRowExit();
  const userId = authUser?.id ?? null;
  const owner = userId ?? "local";
  const needsXLink = deskNeedsXLink(authUser);
  const hasAgenda = agenda.trim().length >= AGENDA_MIN_CHARS;
  const gate = approachGate({ needsXLink, hasAgenda });
  const canOpenForYou = gate === null;

  const [state, setState] = useState<ApproachTaskState | null>(null);
  const stateRef = useRef<ApproachTaskState | null>(null);
  const ownerRef = useRef(owner);
  const lock = state?.lock ?? null;
  const wait = state?.wait ?? null;
  const phase = lock?.phase ?? "done_for_now";

  const releasedIdsRef = useRef(new Set<string>());
  const eligibleScouts = eligibleScoutCards(
    curatedThreads,
    interactedIds,
    releasedIdsRef.current,
  );
  const eligibleCount = eligibleScouts.length;
  const scoutPick = pickApproachScout(eligibleScouts);

  const scoutCardsRef = useRef(new Map<string, ThreadCard>());
  const suggestionCardsRef = useRef(new Map<string, ForYouSuggestion>());
  for (const row of curatedThreads) scoutCardsRef.current.set(row.id, row);
  for (const row of forYouSuggestions) {
    suggestionCardsRef.current.set(row.id, row);
  }
  const lockedScout =
    lock?.phase === "scout_reply" && lock.cardId
      ? scoutCardsRef.current.get(lock.cardId) ?? null
      : null;
  const lockedSuggestion =
    lock?.phase === "organic_reply" && lock.cardId
      ? suggestionCardsRef.current.get(lock.cardId) ?? null
      : null;
  const scoutDetected =
    lock?.phase === "scout_reply" && lock.cardId
      ? vanishEvent({
          cardId: lock.cardId,
          conversationId: lockedScout?.conversationId,
          inReplyToId: lockedScout?.inReplyToId,
          interactedIds,
          history: interactedHistory,
        }) === "mark"
      : false;

  const currentDayUtc = new Date().toISOString().slice(0, 10);
  function pickSuggestion(
    excludeId: string | null,
    afterForYou = false,
  ): ForYouSuggestion | null {
    return pickApproachSuggestion(
      excludeId
        ? forYouSuggestions.filter((row) => row.id !== excludeId)
        : forYouSuggestions,
      {
        allowPost: canServeApproachOriginal({
          scoutReplyDone:
            coaching?.dayUtc === currentDayUtc &&
            coaching?.beats.scoutReplyDone === true,
          afterForYou,
          originalMission:
            coaching?.missions.find(
              (mission) => mission.id === "original_1",
            ) ?? null,
        }),
        interactedIds,
        history: interactedHistory,
        lockedId: excludeId,
      },
    );
  }
  function inventoryFor(
    excludeId: string | null,
    afterForYou = false,
  ): ApproachInventory {
    return {
      scoutId:
        eligibleScouts.find((row) => row.id !== excludeId)?.id ?? null,
      suggestionId: pickSuggestion(excludeId, afterForYou)?.id ?? null,
      canPresentForYou: canOpenForYou,
      gate,
      paceLocked: pace.locked,
    };
  }
  const availableSuggestionId = pickSuggestion(null)?.id ?? null;
  const normalizeRef = useRef<ApproachNormalizeContext>({
    gate,
    scoutId: null,
    suggestionId: null,
    canOpenForYou,
  });
  normalizeRef.current = {
    gate,
    scoutId: scoutPick?.id ?? null,
    suggestionId: availableSuggestionId,
    canOpenForYou,
  };
  const coachingRef = useRef(coaching);
  coachingRef.current = coaching;
  const paceLockedRef = useRef(pace.locked);
  paceLockedRef.current = pace.locked;
  const refreshCoachingRef = useRef(onRefreshCoaching);
  refreshCoachingRef.current = onRefreshCoaching;
  const hydrateInteractedRef = useRef(onHydrateInteracted);
  hydrateInteractedRef.current = onHydrateInteracted;

  /** Persist and publish one task state; transfer Scout preservation atomically. */
  function commit(next: ApproachTaskState) {
    const prev = stateRef.current;
    stateRef.current = next;
    writeApproachLock(userId, next.lock);
    if (next.wait) writeForYouWait(next.wait);
    else clearForYouWait(owner);
    const prevScout =
      prev?.lock.phase === "scout_reply" ? prev.lock.cardId : null;
    const nextScout =
      next.lock.phase === "scout_reply" ? next.lock.cardId : null;
    if (nextScout) {
      const card = scoutCardsRef.current.get(nextScout);
      if (card) writeRetainedScout(userId, card);
    } else {
      clearRetainedScout(userId);
    }
    if (prevScout !== nextScout) {
      void hydrateInteractedRef.current(nextScout);
    }
    setState(next);
  }

  function advanceCard(event: ApproachEvent) {
    const current = stateRef.current;
    if (!current) return;
    const afterForYou =
      isForYouTask(current.lock) &&
      (event.type === "next" || event.type === "bypass");
    const next = transitionApproachTask(
      current,
      event,
      inventoryFor(current.lock.cardId, afterForYou),
      { owner, coaching: coachingRef.current },
    );
    if (next === current) return;
    if (current.lock.cardId && current.lock.cardId !== next.lock.cardId) {
      releasedIdsRef.current.add(current.lock.cardId);
    }
    commit(next);
  }

  useEffect(() => {
    if (ownerRef.current === owner) return;
    ownerRef.current = owner;
    stateRef.current = null;
    releasedIdsRef.current = new Set();
    setState(null);
  }, [owner]);

  useEffect(() => {
    if (!deskBootReady || !agendaReady || stateRef.current) return;
    const stored = readApproachLock(userId);
    const retained = readRetainedScout(userId);
    if (retained && stored?.cardId === retained.id) {
      scoutCardsRef.current.set(retained.id, retained);
    }
    commit(
      restoreApproachTask({
        stored,
        storedWait: readForYouWait(owner),
        normalize: normalizeRef.current,
        paceLocked: paceLockedRef.current,
        task: { owner, coaching: coachingRef.current },
      }),
    );
  }, [agendaReady, deskBootReady, owner, userId]);

  useEffect(() => {
    const current = stateRef.current;
    if (!current || !deskBootReady || !agendaReady) return;
    const next = reconcileApproachGate(current, normalizeRef.current, {
      owner,
      coaching: coachingRef.current,
    });
    if (next !== current) commit(next);
  }, [agendaReady, deskBootReady, gate, owner]);

  useEffect(() => {
    const current = stateRef.current;
    if (
      !current ||
      !shouldAutoAdvanceIdle(
        current.lock.phase,
        eligibleCount,
        availableSuggestionId,
      )
    ) {
      return;
    }
    advanceCard({ type: "next" });
  }, [availableSuggestionId, eligibleCount, phase]);

  useEffect(() => {
    const current = stateRef.current;
    if (!current?.wait || !coaching) return;
    const settled = settleForYouWait(current.wait, coaching);
    if (settled !== current.wait) commit({ lock: current.lock, wait: settled });
  }, [coaching, wait]);

  const cardInput: ApproachCardInput = {
    phase,
    surface: lock?.surface ?? null,
    scout: lockedScout,
    scoutDetected,
    suggestion: lockedSuggestion,
    forYou: wait ? { detected: forYouWaitDetected(wait, coaching) } : null,
    remainingMs: pace.remainingMs,
    coaching,
  };
  const presentation = presentApproach(cardInput);
  const detector = lock ? presentation.detector : null;

  useEffect(() => {
    if (detector !== "for_you") return;
    const interval = window.setInterval(() => {
      void refreshCoachingRef.current({ lite: true });
    }, 12_000);
    return () => window.clearInterval(interval);
  }, [detector]);

  const lockedCardId = lock?.cardId ?? null;
  useEffect(() => {
    if (detector !== "scout" || !lockedCardId) return;
    const interval = window.setInterval(() => {
      void hydrateInteractedRef.current(lockedCardId);
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [detector, lockedCardId]);

  const ready = lock !== null;
  useEffect(() => {
    if (!authUser?.id || !ready) return;
    if (phase === "scout_reply" && !lockedScout) return;
    const card = phase === "scout_reply" ? lockedScout : null;
    if (card) watchDeskThreads([card]);
    void apiFetch("/api/scout-approach-lock", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        card: card
          ? {
              id: card.id,
              conversationId: card.conversationId,
              inReplyToId: card.inReplyToId,
              surface: card.surface,
              author: card.author,
              url: card.url,
              text: card.text,
            }
          : null,
      }),
    }).catch(() => {});
  }, [authUser?.id, lockedScout, phase, ready]);

  const pendingDismissIdRef = useRef<string | null>(null);
  const pendingMarkIdRef = useRef<string | null>(null);
  const autoTriedRef = useRef(readScoutTakeoffTried());
  const bootRefuelCheckedRef = useRef(false);
  const taskRefuelKeyRef = useRef<string | null>(null);
  const [refuelArmed, setRefuelArmed] = useState(false);
  const refuelArmedRef = useRef(false);

  /**
   * The existing low-tank trigger. `consume` is an operator release of an
   * inventory card; it re-opens the session takeoff gate. Task entry does not.
   */
  function armRefuel(
    usableScoutCount: number,
    consume: boolean,
  ): boolean {
    if (
      !shouldArmScoutRefill(usableScoutCount) ||
      refuelArmedRef.current ||
      searching
    ) {
      return false;
    }
    if (!consume && autoTriedRef.current) return false;
    if (consume) {
      clearScoutTakeoffTried();
      autoTriedRef.current = false;
    }
    refuelArmedRef.current = true;
    setRefuelArmed(true);
    return true;
  }

  useEffect(() => {
    if (!deskBootReady || !lock || bootRefuelCheckedRef.current) return;
    bootRefuelCheckedRef.current = true;
    if (
      !shouldArmScoutOnBoot({
        usableScoutCount: eligibleCount,
        alreadyTried: autoTriedRef.current,
        searching,
      })
    ) {
      return;
    }
    refuelArmedRef.current = true;
    setRefuelArmed(true);
  }, [deskBootReady, eligibleCount, lock, searching]);

  const taskKey = state ? approachTaskKey(state) : null;
  const lastTaskKeyRef = useRef<string | null>(null);
  const taskConsumeRef = useRef(false);
  useEffect(() => {
    if (lastTaskKeyRef.current !== taskKey) {
      const previous = lastTaskKeyRef.current;
      lastTaskKeyRef.current = taskKey;
      // Leaving a card re-opens the takeoff gate. Next from one empty For You
      // wait to the next does not: repeated Next is not a refill control.
      taskConsumeRef.current =
        previous !== null &&
        taskKey !== null &&
        !(previous.startsWith("for_you:") && taskKey.startsWith("for_you:"));
    }
    if (!taskKey || !deskBootReady) {
      taskRefuelKeyRef.current = null;
      return;
    }
    if (taskRefuelKeyRef.current === taskKey) return;
    if (!shouldArmScoutRefill(eligibleCount)) return;
    // One arm per task, not one per cooldown tick.
    if (
      refuelArmedRef.current ||
      armRefuel(eligibleCount, taskConsumeRef.current)
    ) {
      taskRefuelKeyRef.current = taskKey;
    }
  }, [deskBootReady, eligibleCount, searching, taskKey]);

  useEffect(() => {
    if (!refuelArmed || !agendaReady) return;
    if (
      !shouldBackgroundScout({
        phase,
        searching,
        grounded,
        cooldownRemainingSec: searchCooldownRemaining,
        needsXLink,
        hasAgenda,
        scoutCount: eligibleCount,
        alreadyTried: autoTriedRef.current,
      })
    ) {
      return;
    }
    autoTriedRef.current = true;
    markScoutTakeoffTried();
    refuelArmedRef.current = false;
    setRefuelArmed(false);
    onSearch();
  }, [
    refuelArmed,
    phase,
    searching,
    grounded,
    searchCooldownRemaining,
    agendaReady,
    needsXLink,
    hasAgenda,
    eligibleCount,
    onSearch,
  ]);

  useEffect(() => {
    if (!deskBootReady || !lock?.cardId) return;
    if (
      pendingDismissIdRef.current === lock.cardId ||
      pendingMarkIdRef.current === lock.cardId
    ) {
      return;
    }
    const cardIsLive =
      (phase === "scout_reply" &&
        (curatedThreads.some((row) => row.id === lock.cardId) ||
          (lockedScout !== null && scoutDetected))) ||
      (phase === "organic_reply" &&
        forYouSuggestions.some((row) => row.id === lock.cardId));
    if (cardIsLive) return;
    const retainedScoutAwaitingHydration =
      phase === "scout_reply" &&
      lockedScout !== null &&
      !curatedThreads.some((row) => row.id === lock.cardId) &&
      !interactedHydrated;
    if (retainedScoutAwaitingHydration) return;
    const event =
      phase === "scout_reply"
        ? vanishEvent({
            cardId: lock.cardId,
            conversationId:
              lockedScout?.conversationId ?? lockedSuggestion?.targetId,
            inReplyToId: lockedScout?.inReplyToId,
            interactedIds,
            history: interactedHistory,
          })
        : "skip";
    advanceCard({ type: event });
    if (event === "skip") armRefuel(eligibleCount, true);
  }, [
    deskBootReady,
    forYouSuggestions,
    interactedHistory,
    interactedHydrated,
    interactedIds,
    lock?.cardId,
    lockedScout,
    lockedSuggestion,
    phase,
    curatedThreads,
    scoutDetected,
  ]);

  useEffect(() => {
    const live = new Set<string>();
    for (const t of curatedThreads) live.add(t.id);
    for (const row of forYouSuggestions) live.add(row.id);
    clearGone(live);
  }, [curatedThreads, forYouSuggestions, clearGone]);
  useEffect(() => {
    if (
      !markThread &&
      pendingMarkIdRef.current &&
      !interactedIds.has(pendingMarkIdRef.current)
    ) {
      pendingMarkIdRef.current = null;
    }
  }, [interactedIds, markThread]);
  useEffect(() => {
    if (
      !dismissThread &&
      pendingDismissIdRef.current &&
      !dismissedHistory.some(
        (entry) => entry.threadId === pendingDismissIdRef.current,
      )
    ) {
      pendingDismissIdRef.current = null;
    }
  }, [dismissedHistory, dismissThread]);
  useEffect(() => {
    const id = pendingDismissIdRef.current;
    if (!id || !dismissedHistory.some((entry) => entry.threadId === id)) return;
    pendingDismissIdRef.current = null;
    advanceCard({ type: "dismiss" });
    armRefuel(eligibleScouts.filter((row) => row.id !== id).length, true);
  }, [dismissedHistory]);
  useEffect(() => {
    const id = pendingMarkIdRef.current;
    if (!id || !interactedIds.has(id)) return;
    pendingMarkIdRef.current = null;
    advanceCard({ type: "mark" });
    armRefuel(eligibleScouts.filter((row) => row.id !== id).length, true);
  }, [interactedIds]);

  function exitRow(
    id: string,
    expandedKey: string,
    then: () => void | Promise<void>,
  ) {
    setExpandedId((cur) => (cur === expandedKey ? null : cur));
    beginExit(id, then);
  }

  const badge =
    agendaReady && ready
      ? approachTabLiveCount({
          phase,
          hasScoutCard: lockedScout != null,
          hasSuggestion: lockedSuggestion != null,
          holdForYouTask: presentation.kind === "for_you",
        })
      : 0;

  return {
    ready,
    cardInput,
    presentation,
    badge,
    clock: pace.clock,
    exitingIds,
    onBypass() {
      pace.bypass();
      advanceCard({ type: "bypass" });
    },
    onScoutMark(thread: ThreadCard) {
      pendingMarkIdRef.current = thread.id;
      onMark(thread);
    },
    onScoutSkip(thread: ThreadCard) {
      exitRow(thread.id, thread.id, async () => {
        const skipped = await onSkip(thread);
        if (skipped) {
          pendingMarkIdRef.current = null;
          pendingDismissIdRef.current = null;
          advanceCard({ type: "skip" });
          armRefuel(
            eligibleScouts.filter((row) => row.id !== thread.id).length,
            true,
          );
        }
      });
    },
    onScoutDismiss(thread: ThreadCard) {
      pendingDismissIdRef.current = thread.id;
      onDismiss(thread);
    },
    onScoutNext() {
      const current = stateRef.current;
      advanceCard({ type: "next" });
      armRefuel(
        eligibleScouts.filter((row) => row.id !== current?.lock.cardId).length,
        true,
      );
    },
    onSuggestionPosted(id: string) {
      exitRow(id, `suggest:${id}`, async () => {
        if (await actForYou(id, "done")) {
          await onRefreshCoaching();
          advanceCard({ type: "posted" });
          armRefuel(eligibleCount, true);
        }
      });
    },
    onSuggestionSkip(id: string) {
      exitRow(id, `suggest:${id}`, async () => {
        if (await actForYou(id, "skip")) {
          advanceCard({ type: "skip" });
          armRefuel(eligibleCount, true);
        }
      });
    },
    onSuggestionDismiss(id: string) {
      exitRow(id, `suggest:${id}`, async () => {
        if (await actForYou(id, "dismiss")) {
          advanceCard({ type: "dismiss" });
          armRefuel(eligibleCount, true);
        }
      });
    },
    onForYouNext() {
      advanceCard({ type: "next" });
      void onRefreshCoaching();
    },
  };
}
