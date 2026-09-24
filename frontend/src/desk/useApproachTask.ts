/**
 * The Approach task machine. One locked card, its For You wait, the refill arm,
 * and the detector it owns. Active cards stay locked until a card button.
 * An empty Collecting card adopts the first Scout that arrives.
 * Collecting Next still fills a suggestion-only tank. Detection marks the same card.
 */
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AuthSessionUser } from "../auth/types";
import { useSession } from "../auth/session";
import type { ScoutStageId } from "../lib/scoutStages";
import { AGENDA_MIN_CHARS } from "../lib/agendaPersist";
import {
  canServeApproachOriginal,
  pickApproachSuggestion,
} from "../lib/approachCard";
import { readApproachLock, writeApproachLock } from "../lib/approachLock";
import {
  adoptEmptyScoutCollecting,
  reconcileApproachGate,
  restoreApproachTask,
  transitionApproachTask,
  type ApproachNormalizeContext,
  type ApproachTaskState,
} from "../lib/approachTask";
import type { CoachingState } from "../lib/coaching";
import { deskNeedsXLink } from "../lib/deskGate";
import {
  approachGate,
  isForYouTask,
  type ApproachEvent,
  type ApproachInventory,
} from "../lib/deskPhase";
import { eligibleScoutCards } from "../lib/deskRefuel";
import type { ForYouSuggestion } from "../lib/forYou";
import { replyPaceSeedIso } from "../lib/replyPace";
import {
  clearForYouWait,
  forYouDetectedActivity,
  forYouWaitDetected,
  latestActivityCursor,
  readForYouWait,
  settleForYouWait,
  writeForYouWait,
} from "../lib/forYouTask";
import { vanishEvent } from "../lib/vanishEvent";
import { apiFetch, apiUrl } from "../lib/apiBase";
import { presentApproach, type ApproachCardInput } from "./approachPresenter";
import {
  clearRetainedScout,
  clearRetainedSuggestion,
  readRetainedScout,
  readRetainedSuggestion,
  writeRetainedScout,
  writeRetainedSuggestion,
} from "./approachRetained";
import { pickApproachScout } from "./approachScout";
import { clearReplyPaceOverlay } from "./replyPaceStore";
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
  interactedRetainedHistory: InteractionHistoryEntry[];
  dismissedHistory: DismissalHistoryEntry[];
  dismissThread: ThreadCard | null;
  searching: boolean;
  scoutStage?: ScoutStageId | null;
  scoutLine?: string | null;
  setExpandedId: Dispatch<SetStateAction<string | null>>;
  actForYou: (
    id: string,
    action: "done" | "skip" | "dismiss",
  ) => Promise<boolean | "gone">;
  onSkip: (thread: ThreadCard) => void | Promise<boolean>;
  onDismiss: (thread: ThreadCard) => void;
  onRefreshCoaching: (opts?: { lite?: boolean }) => void | Promise<void>;
  onHydrateInteracted: (preservedId?: string | null) => void | Promise<void>;
};

export function bypassApproachPace(
  pace: Pick<ReturnType<typeof useReplyPace>, "bypass" | "overlayArmed">,
  advance: () => void,
) {
  pace.bypass();
  if (!pace.overlayArmed) advance();
}

export function useApproachTask(opts: UseApproachTaskOpts) {
  const session = useSession();
  const mountedRef = useRef(false);
  const suggestionDonePendingRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const {
    authUser,
    deskBootReady,
    agendaReady,
    agenda,
    curatedThreads,
    forYouSuggestions,
    coaching,
    interactedIds,
    interactedRetainedHistory,
    dismissedHistory,
    dismissThread,
    searching,
    scoutStage = null,
    scoutLine = null,
    setExpandedId,
    actForYou,
    onSkip,
    onDismiss,
    onRefreshCoaching,
    onHydrateInteracted,
  } = opts;
  const replyPaceSeed = replyPaceSeedIso({
    replyAtIso: coaching?.replyAt?.[0],
    ownActivity: coaching?.ownActivity,
  });
  const pace = useReplyPace(replyPaceSeed);
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
          history: interactedRetainedHistory,
        }) === "mark"
      : false;
  const suggestionDetected =
    lock?.phase === "organic_reply" &&
    lock.cardId &&
    lockedSuggestion?.kind === "reply" &&
    lockedSuggestion.targetId
      ? vanishEvent({
          cardId: lock.cardId,
          conversationId: lockedSuggestion.targetId,
          inReplyToId: lockedSuggestion.targetId,
          interactedIds,
          history: interactedRetainedHistory,
        }) === "mark"
      : false;

  const currentDayUtc = new Date().toISOString().slice(0, 10);
  function pickSuggestion(
    excludeId: string | null,
    afterForYou = false,
  ): ForYouSuggestion | null {
    return pickApproachSuggestion(
      forYouSuggestions.filter(
        (row) => row.id !== excludeId && !releasedIdsRef.current.has(row.id),
      ),
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
        history: interactedRetainedHistory,
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
      paceLocked: livePaceLocked(),
    };
  }
  function livePaceLocked(): boolean {
    return pace.locked;
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
  const activityCursor = latestActivityCursor({
    ownActivity: coaching?.ownActivity ?? null,
    history: interactedRetainedHistory,
  });
  const cursorRef = useRef(activityCursor);
  cursorRef.current = activityCursor;
  const refreshCoachingRef = useRef(onRefreshCoaching);
  refreshCoachingRef.current = onRefreshCoaching;
  const hydrateInteractedRef = useRef(onHydrateInteracted);
  hydrateInteractedRef.current = onHydrateInteracted;

  /** Persist and publish one task state; transfer Scout preservation atomically. */
  function commit(next: ApproachTaskState, preserveOverlay = false) {
    const prev = stateRef.current;
    if (
      !preserveOverlay && pace.overlayArmed && prev &&
      prev.lock.cardId !== next.lock.cardId
    ) {
      clearReplyPaceOverlay();
    }
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
    const nextSuggestion =
      next.lock.phase === "organic_reply" ? next.lock.cardId : null;
    if (nextSuggestion) {
      const suggestion = suggestionCardsRef.current.get(nextSuggestion);
      if (suggestion) writeRetainedSuggestion(userId, suggestion);
    } else {
      clearRetainedSuggestion(userId);
    }
    if (prevScout !== nextScout) {
      Promise.resolve(hydrateInteractedRef.current(nextScout)).catch((err: unknown) => console.error(err));
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
      { owner, cursor: cursorRef.current },
    );
    if (next === current) return;
    const armOverlay =
      event.type === "next" &&
      next.lock !== current.lock && pace.remainingMs > 0;
    if (armOverlay) {
      pace.armOverlay();
    }
    if (current.lock.cardId && current.lock.cardId !== next.lock.cardId) {
      releasedIdsRef.current.add(current.lock.cardId);
    }
    commit(next, armOverlay);
  }

  useEffect(() => {
    if (ownerRef.current === owner) return;
    ownerRef.current = owner;
    clearReplyPaceOverlay();
    stateRef.current = null;
    releasedIdsRef.current = new Set();
    setState(null);
  }, [owner]);

  useEffect(() => {
    if (!deskBootReady || !agendaReady || stateRef.current) return;
    const stored = readApproachLock(userId);
    const retained = readRetainedScout(userId);
    const retainedSuggestion = readRetainedSuggestion(userId);
    if (retained && stored?.cardId === retained.id) {
      scoutCardsRef.current.set(retained.id, retained);
    }
    if (retainedSuggestion && stored?.cardId === retainedSuggestion.id) {
      suggestionCardsRef.current.set(retainedSuggestion.id, retainedSuggestion);
    }
    commit(
      restoreApproachTask({
        stored,
        storedWait: readForYouWait(owner),
        normalize: normalizeRef.current,
        paceLocked: livePaceLocked(),
        task: { owner, cursor: cursorRef.current },
      }),
    );
  }, [agendaReady, deskBootReady, owner, userId]);

  useEffect(() => {
    const current = stateRef.current;
    if (!current || !deskBootReady || !agendaReady) return;
    const next = reconcileApproachGate(current, normalizeRef.current, {
      owner,
      cursor: cursorRef.current,
    });
    if (next !== current) commit(next);
  }, [agendaReady, deskBootReady, gate, owner]);

  useEffect(() => {
    const current = stateRef.current;
    if (!current) return;
    const next = adoptEmptyScoutCollecting(current, scoutPick?.id ?? null);
    if (next !== current) commit(next, pace.overlayArmed);
  }, [lock?.cardId, lock?.phase, scoutPick?.id]);

  useEffect(() => {
    const current = stateRef.current;
    if (!current?.wait) return;
    const settled = settleForYouWait(current.wait, cursorRef.current);
    if (settled !== current.wait) commit({ lock: current.lock, wait: settled });
  }, [activityCursor?.id, activityCursor?.postedAt, wait]);

  const cardInput: ApproachCardInput = {
    phase,
    surface: lock?.surface ?? null,
    scout: lockedScout,
    scoutDetected,
    suggestion: lockedSuggestion,
    suggestionDetected,
    forYou: wait
      ? {
          detected: forYouWaitDetected(wait, activityCursor),
          activity: forYouDetectedActivity(wait, activityCursor),
        }
      : null,
    remainingMs: pace.remainingMs,
    paceOverlayArmed: pace.overlayArmed,
    searching,
    scoutStage,
    scoutLine,
    collectingReady:
      phase === "done_for_now"
        ? eligibleCount > 0 || availableSuggestionId !== null
        : phase === "scout_reply" && lock?.cardId === null && eligibleCount > 0,
    coaching,
  };
  const presentation = presentApproach(cardInput);
  const detector = lock ? presentation.detector : null;

  useEffect(() => {
    if (detector !== "for_you") return;
    const source = new EventSource(apiUrl("/api/desk/events"), { withCredentials: true });
    source.addEventListener("own_post", () => {
      Promise.resolve(refreshCoachingRef.current({ lite: true })).catch((err: unknown) => console.error(err));
    });
    const interval = window.setInterval(() => {
      Promise.resolve(refreshCoachingRef.current({ lite: true })).catch((err: unknown) => console.error(err));
    }, 12_000);
    return () => {
      source.close();
      window.clearInterval(interval);
    };
  }, [detector, owner]);

  const lockedCardId = lock?.cardId ?? null;
  useEffect(() => {
    if (detector !== "scout" || !lockedCardId) return;
    const interval = window.setInterval(() => {
      Promise.resolve(hydrateInteractedRef.current(lockedCardId)).catch((err: unknown) => console.error(err));
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [detector, lockedCardId]);

  const ready = lock !== null;
  useEffect(() => {
    if (!authUser?.id || !ready) return;
    if (phase === "scout_reply" && !lockedScout) return;
    const suggestedTarget =
      phase === "organic_reply" &&
      lockedSuggestion?.kind === "reply" &&
      lockedSuggestion.targetId
        ? {
            id: lockedSuggestion.targetId,
            conversationId: lockedSuggestion.targetId,
            inReplyToId: lockedSuggestion.targetId,
            surface: "reply" as const,
            author: lockedSuggestion.targetAuthor,
            url: lockedSuggestion.targetUrl,
            text: lockedSuggestion.draft ?? lockedSuggestion.why ?? null,
          }
        : null;
    const scoutLock = phase === "scout_reply" ? lockedScout : null;
    if (scoutLock) {
      watchDeskThreads([scoutLock]);
    } else if (suggestedTarget) {
      watchDeskThreads([{
        ...suggestedTarget,
        author: suggestedTarget.author ?? "",
        url: suggestedTarget.url ?? "",
        text: suggestedTarget.text ?? "",
      }]);
    }
    void apiFetch("/api/scout-approach-lock", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        card: scoutLock
          ? {
              id: scoutLock.id,
              conversationId: scoutLock.conversationId,
              inReplyToId: scoutLock.inReplyToId,
              surface: scoutLock.surface,
              author: scoutLock.author,
              url: scoutLock.url,
              text: scoutLock.text,
            }
          : suggestedTarget,
      }),
    }).catch(() => {});
  }, [authUser?.id, lockedScout, lockedSuggestion, phase, ready]);

  const pendingDismissIdRef = useRef<string | null>(null);

  useEffect(() => {
    const live = new Set<string>();
    for (const t of curatedThreads) live.add(t.id);
    for (const row of forYouSuggestions) live.add(row.id);
    clearGone(live);
  }, [curatedThreads, forYouSuggestions, clearGone]);
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
  }, [dismissedHistory]);
  function exitRow(
    id: string,
    expandedKey: string,
    then: () => void | Promise<void>,
  ) {
    setExpandedId((cur) => (cur === expandedKey ? null : cur));
    beginExit(id, then);
  }

  async function onSuggestionNext(id: string) {
    const generation = session.capture();
    const currentLock = stateRef.current?.lock;
    if (!mountedRef.current || !session.isCurrent(generation) ||
      suggestionDonePendingRef.current || currentLock?.cardId !== id) return;
    suggestionDonePendingRef.current = true;
    try {
      const acknowledged = await actForYou(id, "done");
      if (acknowledged === false || !mountedRef.current || !session.isCurrent(generation) ||
        stateRef.current?.lock !== currentLock) return;
      await onRefreshCoaching();
      advanceCard({ type: "next" });
    } finally {
      suggestionDonePendingRef.current = false;
    }
  }

  const badge = agendaReady && ready ? presentation.badge : 0;

  return {
    ready,
    cardInput,
    presentation,
    badge,
    clock: pace.clock,
    exitingIds,
    onBypass() {
      bypassApproachPace(pace, () => {
        advanceCard({ type: "bypass" });
      });
    },
    onScoutSkip(thread: ThreadCard) {
      exitRow(thread.id, thread.id, async () => {
        const skipped = await onSkip(thread);
        if (skipped) {
          pendingDismissIdRef.current = null;
          advanceCard({ type: "skip" });
        }
      });
    },
    onScoutDismiss(thread: ThreadCard) {
      pendingDismissIdRef.current = thread.id;
      onDismiss(thread);
    },
    onScoutNext() {
      advanceCard({ type: "next" });
    },
    onSuggestionPosted(id: string) {
      const row = suggestionCardsRef.current.get(id);
      if (
        suggestionDetected &&
        row?.kind === "reply" &&
        row.targetId
      ) {
        onSuggestionNext(id).catch((err: unknown) => console.error(err));
        return;
      }
      exitRow(id, `suggest:${id}`, async () => {
        if ((await actForYou(id, "done")) === true) {
          await onRefreshCoaching();
          advanceCard({ type: "posted" });
        }
      });
    },
    onSuggestionSkip(id: string) {
      exitRow(id, `suggest:${id}`, async () => {
        if ((await actForYou(id, "skip")) === true) {
          advanceCard({ type: "skip" });
        }
      });
    },
    onSuggestionDismiss(id: string) {
      exitRow(id, `suggest:${id}`, async () => {
        if ((await actForYou(id, "dismiss")) === true) {
          advanceCard({ type: "dismiss" });
        }
      });
    },
    onForYouNext() {
      advanceCard({ type: "next" });
      Promise.resolve(onRefreshCoaching()).catch((err: unknown) => console.error(err));
    },
  };
}
