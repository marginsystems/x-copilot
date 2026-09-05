import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AuthSessionUser } from "../auth/types";
import {
  APPROACH_TAB_LABEL,
  FYP_DETECTED_COPY,
  FYP_DETECTING_COPY,
  type ForYouExtraUsage,
  type ForYouProgress,
  type ForYouSuggestion,
} from "../lib/forYou";
import { deskNeedsXLink } from "../lib/deskGate";
import {
  canServeApproachOriginal,
  pickApproachSuggestion,
} from "../lib/approachCard";
import {
  advanceApproach,
  approachTabLiveCount,
  initialApproachLock,
  type ApproachEvent,
  type ApproachLock,
} from "../lib/deskPhase";
import {
  clearScoutTakeoffTried,
  markScoutTakeoffTried,
  readScoutTakeoffTried,
  shouldBackgroundScout,
} from "../lib/deskRefuel";
import {
  canPresentForYouTask,
  clearForYouWait,
  hasDetectedForYouPost,
  readForYouWait,
  snapshotForYouWait,
  writeForYouWait,
  type ForYouWait,
} from "../lib/forYouTask";
import { AGENDA_MIN_CHARS } from "../lib/agendaPersist";
import type { VoiceState } from "../lib/voice";
import {
  DismissedRow,
  ExpiredRow,
  InteractedRow,
  SkippedRow,
} from "./HistoryRows";
import { RankingDrawer } from "./RankingDrawer";
import {
  ApproachLoadingCard,
  MissionCard,
  pickApproachScout,
} from "./MissionCard";
import { preferRootTargets } from "../lib/scoutTarget";
import { useReplyPace } from "./useReplyPace";
import {
  postDeskForkChoice,
  postDeskOriginalPosted,
  type CoachingState,
} from "../lib/coaching";
import type { DeskBeats } from "../lib/deskPhase";
import { useDeskRowExit } from "./useDeskRowExit";
import { ThreadsTabCount } from "./ThreadsTabCount";
import type {
  DismissalHistoryEntry,
  ExpiredHistoryEntry,
  InteractionHistoryEntry,
  SkipHistoryEntry,
  ThreadCard,
  ThreadsTab,
} from "./types";

type ThreadsTabsProps = {
  threadsTab: ThreadsTab;
  setThreadsTab: (tab: ThreadsTab) => void;
  curatedThreads: ThreadCard[];
  forYouSuggestions: ForYouSuggestion[];
  forYouProgress?: ForYouProgress | null;
  forYouExtra?: ForYouExtraUsage | null;
  coaching?: CoachingState | null;
  requestExtra?: () => void | Promise<void>;
  interactedHistory: InteractionHistoryEntry[];
  skippedHistory: SkipHistoryEntry[];
  dismissedHistory: DismissalHistoryEntry[];
  expiredHistory: ExpiredHistoryEntry[];
  searching: boolean;
  actionBusy: boolean;
  expandedId: string | null;
  setExpandedId: Dispatch<SetStateAction<string | null>>;
  interactedIds: Set<string>;
  voice: VoiceState | null;
  agenda: string;
  agendaReady: boolean;
  deskBootReady: boolean;
  authUser: AuthSessionUser | null;
  markThread: ThreadCard | null;
  dismissThread: ThreadCard | null;
  setVoice: Dispatch<SetStateAction<VoiceState | null>>;
  actForYou: (
    id: string,
    action: "done" | "skip" | "dismiss",
  ) => Promise<boolean>;
  onOpenVoice: () => void;
  onOpenSettings: () => void;
  onOpenUsage: () => void;
  onLinkX: () => void;
  grounded: boolean;
  groundedLine: string | null;
  searchCooldownRemaining: number;
  onSearch: () => void;
  onMark: (thread: ThreadCard) => void;
  onSkip: (thread: ThreadCard) => void | Promise<boolean>;
  onDismiss: (thread: ThreadCard) => void;
  onRefreshCoaching: () => void | Promise<void>;
  setActionBusy: (busy: boolean) => void;
  setStatus: (status: string) => void;
  onForkBeats: (beats: DeskBeats) => void;
};

export function ThreadsTabs({
  threadsTab,
  setThreadsTab,
  curatedThreads,
  forYouSuggestions,
  forYouProgress,
  forYouExtra,
  coaching,
  requestExtra,
  interactedHistory,
  skippedHistory,
  dismissedHistory,
  expiredHistory,
  searching,
  actionBusy,
  expandedId,
  setExpandedId,
  interactedIds,
  voice,
  agenda,
  agendaReady,
  deskBootReady,
  authUser,
  markThread,
  dismissThread,
  setVoice,
  actForYou,
  onOpenVoice,
  onOpenSettings,
  onOpenUsage,
  onLinkX,
  grounded,
  groundedLine,
  searchCooldownRemaining,
  onSearch,
  onMark,
  onSkip,
  onDismiss,
  onRefreshCoaching,
  setActionBusy,
  setStatus,
  onForkBeats,
}: ThreadsTabsProps) {
  const pace = useReplyPace();
  const { exitingIds, beginExit, clearGone } = useDeskRowExit();
  const scouted = preferRootTargets(curatedThreads);
  const scout = pickApproachScout(scouted);
  const pendingDismissIdRef = useRef<string | null>(null);
  const pendingMarkIdRef = useRef<string | null>(null);
  const canPresentForYou = canPresentForYouTask({
    needsXLink: deskNeedsXLink(authUser),
    hasAgenda: agenda.trim().length >= AGENDA_MIN_CHARS,
    grounded,
    cooldownRemaining: searchCooldownRemaining,
  });
  const silentFallback = deskNeedsXLink(authUser)
    ? "link_x"
    : agenda.trim().length < AGENDA_MIN_CHARS
      ? "settings"
      : grounded
        ? "usage"
        : searchCooldownRemaining > 0
          ? "wait"
          : "for_you";
  const [forYouWait, setForYouWait] = useState<ForYouWait | null>(() => {
    const existing = readForYouWait();
    if (existing) return existing;
    if (scout || !deskBootReady || !canPresentForYou) return null;
    const wait: ForYouWait = {
      held: true,
      snapshot: snapshotForYouWait(coaching),
    };
    writeForYouWait(wait);
    return wait;
  });
  const forYouHeld = forYouWait?.held === true;
  useEffect(() => {
    if (!forYouWait || forYouWait.snapshot || !coaching) return;
    const wait: ForYouWait = {
      held: true,
      snapshot: snapshotForYouWait(coaching),
    };
    writeForYouWait(wait);
    setForYouWait(wait);
  }, [forYouWait, coaching]);
  const refreshCoachingRef = useRef(onRefreshCoaching);
  refreshCoachingRef.current = onRefreshCoaching;
  useEffect(() => {
    if (!forYouHeld) return;
    const interval = window.setInterval(() => {
      void refreshCoachingRef.current();
    }, 12_000);
    return () => window.clearInterval(interval);
  }, [forYouHeld]);
  const forYouStatus = forYouWait?.snapshot
    ? hasDetectedForYouPost(forYouWait.snapshot, coaching)
      ? FYP_DETECTED_COPY
      : FYP_DETECTING_COPY
    : undefined;
  const currentDayUtc = new Date().toISOString().slice(0, 10);
  const suggestion = pickApproachSuggestion(forYouSuggestions, {
    allowPost: canServeApproachOriginal({
      scoutReplyDone:
        coaching?.dayUtc === currentDayUtc &&
        coaching?.beats.scoutReplyDone === true,
      originalMission:
        coaching?.missions.find((mission) => mission.id === "original_1") ??
        null,
    }),
  });
  const scoutCardsRef = useRef(new Map<string, ThreadCard>());
  const suggestionCardsRef = useRef(new Map<string, ForYouSuggestion>());
  for (const row of scouted) scoutCardsRef.current.set(row.id, row);
  for (const row of forYouSuggestions) {
    suggestionCardsRef.current.set(row.id, row);
  }
  const [locked, setLocked] = useState<ApproachLock>(() =>
    initialApproachLock({
      forYouHeld,
      paceLocked: pace.locked,
      scoutId: scout?.id ?? null,
      fallback: silentFallback,
    }),
  );
  const phase = locked.phase;
  const hold = phase === "hold";
  const holdForYouTask =
    (phase === "silent_refuel" || phase === "hold") &&
    locked.surface === "for_you";
  const lockedScout = locked.cardId
    ? scoutCardsRef.current.get(locked.cardId) ?? null
    : null;
  const lockedSuggestion = locked.cardId
    ? suggestionCardsRef.current.get(locked.cardId) ?? null
    : null;
  const autoTriedRef = useRef(readScoutTakeoffTried());
  const [refuelArmed, setRefuelArmed] = useState(false);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  function advanceCard(event: ApproachEvent) {
    const current = lockedRef.current;
    const next = advanceApproach(current, event, {
      scoutId:
        scouted.find((row) => row.id !== current.cardId)?.id ?? null,
      suggestionId:
        (suggestion?.id !== current.cardId
          ? suggestion
          : pickApproachSuggestion(
              forYouSuggestions.filter((row) => row.id !== current.cardId),
              {
                allowPost: canServeApproachOriginal({
                  scoutReplyDone:
                    coaching?.dayUtc === currentDayUtc &&
                    coaching?.beats.scoutReplyDone === true,
                  originalMission:
                    coaching?.missions.find(
                      (mission) => mission.id === "original_1",
                    ) ?? null,
                }),
              },
            )
        )?.id ?? null,
      canPresentForYou,
    });
    if (next === current) return;
    lockedRef.current = next;
    if (next.surface === "for_you" && !forYouWait) {
      const wait: ForYouWait = {
        held: true,
        snapshot: snapshotForYouWait(coaching),
      };
      writeForYouWait(wait);
      setForYouWait(wait);
    }
    setLocked(next);
  }

  useEffect(() => {
    if (!deskBootReady || phase !== "silent_refuel") return;
    let nextForYouHeld = forYouHeld;
    if (!scout && canPresentForYou && !forYouWait) {
      const wait: ForYouWait = {
        held: true,
        snapshot: snapshotForYouWait(coaching),
      };
      writeForYouWait(wait);
      setForYouWait(wait);
      nextForYouHeld = true;
    }
    const next = initialApproachLock({
      forYouHeld: nextForYouHeld,
      paceLocked: pace.locked,
      scoutId: scout?.id ?? null,
      fallback: silentFallback,
    });
    lockedRef.current = next;
    setLocked(next);
  }, [
    deskBootReady,
    forYouHeld,
    forYouWait,
    canPresentForYou,
    coaching,
    locked.surface,
    pace.locked,
    phase,
    scout?.id,
    silentFallback,
  ]);

  useEffect(() => {
    if (phase !== "done_for_now" || (!scout && !suggestion)) return;
    advanceCard({ type: "next" });
  }, [phase, scout, suggestion]);

  useEffect(() => {
    if (!deskBootReady || !locked.cardId) return;
    if (
      pendingDismissIdRef.current === locked.cardId ||
      pendingMarkIdRef.current === locked.cardId
    ) {
      return;
    }
    const cardIsLive =
      (phase === "scout_reply" &&
        scouted.some((row) => row.id === locked.cardId)) ||
      (phase === "organic_reply" &&
        forYouSuggestions.some((row) => row.id === locked.cardId));
    if (!cardIsLive) {
      advanceCard({ type: "skip" });
      armRefuel();
    }
  }, [deskBootReady, forYouSuggestions, locked.cardId, phase, scouted]);

  function armRefuel() {
    clearScoutTakeoffTried();
    autoTriedRef.current = false;
    setRefuelArmed(true);
  }

  useEffect(() => {
    const live = new Set<string>();
    for (const t of curatedThreads) live.add(t.id);
    for (const row of forYouSuggestions) live.add(row.id);
    clearGone(live);
  }, [curatedThreads, forYouSuggestions, clearGone]);
  useEffect(() => {
    if (!refuelArmed || !agendaReady) return;
    if (
      !shouldBackgroundScout({
        phase,
        searching,
        grounded,
        cooldownRemainingSec: searchCooldownRemaining,
        needsXLink: deskNeedsXLink(authUser),
        hasAgenda: agenda.trim().length >= AGENDA_MIN_CHARS,
        scoutCount: scouted.length,
        alreadyTried: autoTriedRef.current,
      })
    ) {
      return;
    }
    autoTriedRef.current = true;
    markScoutTakeoffTried();
    setRefuelArmed(false);
    onSearch();
  }, [
    refuelArmed,
    phase,
    searching,
    grounded,
    searchCooldownRemaining,
    agendaReady,
    authUser,
    agenda,
    curatedThreads,
    onSearch,
  ]);
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
    armRefuel();
  }, [dismissedHistory]);
  useEffect(() => {
    const id = pendingMarkIdRef.current;
    if (!id || !interactedIds.has(id)) return;
    pendingMarkIdRef.current = null;
    advanceCard({ type: "mark" });
  }, [interactedIds]);
  function exitRow(
    id: string,
    expandedKey: string,
    then: () => void | Promise<void>,
  ) {
    setExpandedId((cur) => (cur === expandedKey ? null : cur));
    beginExit(id, then);
  }
  return (
    <>
      <div className="threads-pane-head">
        <div className="threads-pane-title">
          <h2 className="section-label">Threads</h2>
          {threadsTab === "curated" ? <RankingDrawer /> : null}
        </div>
        <div className="threads-tabs" role="tablist" aria-label="Thread feeds">
          <button
            type="button"
            role="tab"
            aria-selected={threadsTab === "curated"}
            className={
              threadsTab === "curated"
                ? "threads-tab active"
                : "threads-tab"
            }
            onClick={() => setThreadsTab("curated")}
          >
            {APPROACH_TAB_LABEL}
            <ThreadsTabCount
              n={
                agendaReady
                  ? approachTabLiveCount({
                      phase,
                      hasScoutCard: lockedScout != null,
                      hasSuggestion: lockedSuggestion != null,
                      holdForYouTask,
                    })
                  : 0
              }
            />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={threadsTab === "interacted"}
            className={
              threadsTab === "interacted"
                ? "threads-tab active"
                : "threads-tab"
            }
            onClick={() => setThreadsTab("interacted")}
          >
            Interacted
            <ThreadsTabCount n={interactedHistory.length} />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={threadsTab === "skipped"}
            className={
              threadsTab === "skipped"
                ? "threads-tab active"
                : "threads-tab"
            }
            onClick={() => setThreadsTab("skipped")}
          >
            Skipped
            <ThreadsTabCount n={skippedHistory.length} />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={threadsTab === "dismissed"}
            className={
              threadsTab === "dismissed"
                ? "threads-tab active"
                : "threads-tab"
            }
            onClick={() => setThreadsTab("dismissed")}
          >
            Not interested
            <ThreadsTabCount n={dismissedHistory.length} />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={threadsTab === "expired"}
            className={
              threadsTab === "expired"
                ? "threads-tab active"
                : "threads-tab"
            }
            onClick={() => setThreadsTab("expired")}
          >
            Expired
            <ThreadsTabCount n={expiredHistory.length} />
          </button>
        </div>
      </div>
      <div className="threads-scroll">
        {threadsTab === "curated" ? (
          !agendaReady ? (
            <ApproachLoadingCard />
          ) : (
          <MissionCard
            phase={phase}
            hold={hold}
            clock={pace.clock}
            remainingMs={pace.remainingMs}
            onBypass={() => {
              pace.bypass();
              advanceCard({ type: "bypass" });
              armRefuel();
            }}
            groundedLine={groundedLine}
            silentCard={locked.surface}
            forYouStatus={forYouStatus}
            onOpenUsage={onOpenUsage}
            onOpenSettings={onOpenSettings}
            forYouProgress={forYouProgress}
            forYouExtra={forYouExtra}
            coaching={coaching}
            requestExtra={requestExtra}
            scout={lockedScout}
            suggestion={lockedSuggestion}
            actionBusy={actionBusy}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            interactedIds={interactedIds}
            voice={voice}
            agenda={agenda}
            authUser={authUser}
            setVoice={setVoice}
            exitingIds={exitingIds}
            onScoutMark={(thread) => {
              pendingMarkIdRef.current = thread.id;
              onMark(thread);
            }}
            onScoutSkip={(thread) => {
              exitRow(thread.id, thread.id, async () => {
                const skipped = await onSkip(thread);
                if (skipped) {
                  pendingMarkIdRef.current = null;
                  pendingDismissIdRef.current = null;
                  advanceCard({ type: "skip" });
                  armRefuel();
                }
              });
            }}
            onScoutDismiss={(thread) => {
              pendingDismissIdRef.current = thread.id;
              onDismiss(thread);
            }}
            onSuggestionPosted={(id) => {
              exitRow(id, `suggest:${id}`, async () => {
                if (await actForYou(id, "done")) {
                  advanceCard({ type: "posted" });
                  armRefuel();
                }
              });
            }}
            onSuggestionSkip={(id) => {
              exitRow(id, `suggest:${id}`, async () => {
                if (await actForYou(id, "skip")) {
                  advanceCard({ type: "skip" });
                  armRefuel();
                }
              });
            }}
            onSuggestionDismiss={(id) => {
              exitRow(id, `suggest:${id}`, async () => {
                if (await actForYou(id, "dismiss")) {
                  advanceCard({ type: "dismiss" });
                  armRefuel();
                }
              });
            }}
            onChooseFork={(choice) => {
              void (async () => {
                setActionBusy(true);
                try {
                  const beats = await postDeskForkChoice(choice);
                  if (!beats) {
                    setStatus("Fork choice failed. Try again.");
                    return;
                  }
                  onForkBeats(beats);
                  advanceCard({ type: "fork", choice });
                  armRefuel();
                  await onRefreshCoaching();
                } finally {
                  setActionBusy(false);
                }
              })();
            }}
            onOriginalPosted={() => {
              void (async () => {
                setActionBusy(true);
                try {
                  const beats = await postDeskOriginalPosted();
                  if (!beats) {
                    setStatus("Could not record the original. Try again.");
                    return;
                  }
                  onForkBeats(beats);
                  advanceCard({ type: "posted" });
                  armRefuel();
                  await onRefreshCoaching();
                } finally {
                  setActionBusy(false);
                }
              })();
            }}
            onForYouNext={() => {
              clearForYouWait();
              setForYouWait(null);
              advanceCard({ type: "next" });
              armRefuel();
            }}
            onOpenVoice={onOpenVoice}
            onLinkX={onLinkX}
          />
          )
        ) : threadsTab === "interacted" ? (
          interactedHistory.length === 0 ? (
            <p className="empty">
              No interacted threads yet. Open on X, then tap I posted on X after you reply.
            </p>
          ) : (
            <div className="history-list">
              {interactedHistory.map((entry, i) => (
                <InteractedRow
                  key={entry.threadId}
                  entry={entry}
                  index={i}
                />
              ))}
            </div>
          )
        ) : threadsTab === "skipped" ? (
          skippedHistory.length === 0 ? (
            <p className="empty">
              No skipped threads yet. Skip an Approach lead to pass on it
              without dismissing the author.
            </p>
          ) : (
            <div className="history-list">
              {skippedHistory.map((entry, i) => (
                <SkippedRow
                  key={entry.threadId}
                  entry={entry}
                  index={i}
                />
              ))}
            </div>
          )
        ) : threadsTab === "dismissed" ? (
          dismissedHistory.length === 0 ? (
            <p className="empty">
              No dismissed threads yet. Mark an Approach lead as not interested
              to dismiss it with an optional reason.
            </p>
          ) : (
            <div className="history-list">
              {dismissedHistory.map((entry, i) => (
                <DismissedRow
                  key={entry.threadId}
                  entry={entry}
                  index={i}
                />
              ))}
            </div>
          )
        ) : expiredHistory.length === 0 ? (
          <p className="empty">
            No expired threads yet. Cool leads older than 24h move here
            automatically.
          </p>
        ) : (
          <div className="history-list">
            {expiredHistory.map((entry, i) => (
              <ExpiredRow
                key={entry.threadId}
                entry={entry}
                index={i}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
