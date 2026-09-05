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
  approachTabLiveCount,
  deskPhase,
  emptyDeskBeats,
} from "../lib/deskPhase";
import { shouldBackgroundScout } from "../lib/deskRefuel";
import {
  canPresentForYouTask,
  clearForYouWait,
  hasDetectedForYouPost,
  readForYouWait,
  shouldHoldForYouTask,
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
  authUser: AuthSessionUser | null;
  setVoice: Dispatch<SetStateAction<VoiceState | null>>;
  actForYou: (id: string, action: "done" | "skip" | "dismiss") => void | Promise<void>;
  onOpenVoice: () => void;
  onOpenSettings: () => void;
  onOpenUsage: () => void;
  onLinkX: () => void;
  grounded: boolean;
  groundedLine: string | null;
  searchCooldownRemaining: number;
  onSearch: () => void;
  onStopScout: () => void;
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
  authUser,
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
  onStopScout,
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
  const scoutCountRef = useRef(scouted.length);
  const consumedScoutRef = useRef(false);
  const pendingDismissIdRef = useRef<string | null>(null);
  const autoTriedRef = useRef(false);
  if (scouted.length > scoutCountRef.current) {
    consumedScoutRef.current = false;
    autoTriedRef.current = false;
  }
  if (
    pendingDismissIdRef.current &&
    dismissedHistory.some(
      (entry) => entry.threadId === pendingDismissIdRef.current,
    ) &&
    !scouted.some((thread) => thread.id === pendingDismissIdRef.current)
  ) {
    consumedScoutRef.current = true;
    pendingDismissIdRef.current = null;
  }
  scoutCountRef.current = scouted.length;
  const tanksEmpty =
    scouted.length === 0 && forYouSuggestions.length === 0;
  const canPresentForYou = canPresentForYouTask({
    needsXLink: deskNeedsXLink(authUser),
    hasAgenda: agenda.trim().length >= AGENDA_MIN_CHARS,
    grounded,
    cooldownRemaining: searchCooldownRemaining,
  });
  const [forYouWait, setForYouWait] = useState<ForYouWait | null>(
    readForYouWait,
  );
  const [forYouReleased, setForYouReleased] = useState(false);
  const forYouHeld = forYouWait?.held === true;
  const holdForYouTask = shouldHoldForYouTask({
    held: forYouHeld,
    tanksEmpty,
    canPresent: canPresentForYou,
    arm: !consumedScoutRef.current,
  });
  useEffect(() => {
    if (holdForYouTask && !forYouHeld && !forYouReleased) {
      const wait: ForYouWait = {
        held: true,
        snapshot: snapshotForYouWait(coaching),
      };
      writeForYouWait(wait);
      setForYouWait(wait);
    }
  }, [holdForYouTask, forYouHeld, forYouReleased, coaching]);
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
  const { phase, hold } = deskPhase({
    needsOnboarding: false,
    paceLocked: pace.locked,
    overheat: false,
    hasScoutCard: scouted.length > 0,
    hasSuggestion: suggestion != null,
    searching,
    holdForYouTask,
    beats: coaching?.beats ?? emptyDeskBeats(),
  });
  const previousPhaseRef = useRef(phase);
  const wasSearchingRef = useRef(false);
  useEffect(() => {
    const live = new Set<string>();
    for (const t of curatedThreads) live.add(t.id);
    for (const row of forYouSuggestions) live.add(row.id);
    clearGone(live);
  }, [curatedThreads, forYouSuggestions, clearGone]);
  useEffect(() => {
    if (!agendaReady) return;
    const waiting =
      phase === "silent_refuel" ||
      phase === "hold" ||
      phase === "scout_reply" ||
      phase === "organic_reply";
    if (
      (previousPhaseRef.current === "silent_refuel" ||
        previousPhaseRef.current === "hold") &&
      !waiting
    ) {
      autoTriedRef.current = false;
    }
    previousPhaseRef.current = phase;
    if (!waiting) {
      return;
    }
    if (searching) {
      wasSearchingRef.current = true;
      return;
    }
    if (wasSearchingRef.current) {
      wasSearchingRef.current = false;
      if (phase === "silent_refuel" || phase === "hold") {
        autoTriedRef.current = false;
      }
    }
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
    onSearch();
  }, [
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
                      hasScoutCard: scouted.length > 0,
                      hasSuggestion: suggestion != null,
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
            onBypass={pace.bypass}
            searching={searching}
            grounded={grounded}
            groundedLine={groundedLine}
            cooldownRemaining={searchCooldownRemaining}
            holdForYouTask={holdForYouTask}
            forYouStatus={forYouStatus}
            onStopScout={onStopScout}
            onOpenUsage={onOpenUsage}
            onOpenSettings={onOpenSettings}
            forYouProgress={forYouProgress}
            forYouExtra={forYouExtra}
            coaching={coaching}
            requestExtra={requestExtra}
            scout={scout}
            suggestion={suggestion}
            actionBusy={actionBusy}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            interactedIds={interactedIds}
            voice={voice}
            agenda={agenda}
            authUser={authUser}
            setVoice={setVoice}
            exitingIds={exitingIds}
            onScoutMark={onMark}
            onScoutSkip={(thread) => {
              exitRow(thread.id, thread.id, async () => {
                const skipped = await onSkip(thread);
                if (skipped) {
                  consumedScoutRef.current = true;
                  autoTriedRef.current = false;
                }
              });
            }}
            onScoutDismiss={(thread) => {
              pendingDismissIdRef.current = thread.id;
              onDismiss(thread);
            }}
            onSuggestionPosted={(id) =>
              exitRow(id, `suggest:${id}`, () => actForYou(id, "done"))
            }
            onSuggestionSkip={(id) =>
              exitRow(id, `suggest:${id}`, () => actForYou(id, "skip"))
            }
            onSuggestionDismiss={(id) =>
              exitRow(id, `suggest:${id}`, () => actForYou(id, "dismiss"))
            }
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
                  await onRefreshCoaching();
                } finally {
                  setActionBusy(false);
                }
              })();
            }}
            onForYouNext={() => {
              if (tanksEmpty && searchCooldownRemaining > 0) return;
              clearForYouWait();
              setForYouWait(null);
              setForYouReleased(true);
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
