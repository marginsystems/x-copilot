import {
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AuthSessionUser } from "../auth/types";
import {
  APPROACH_TAB_LABEL,
  type ForYouExtraUsage,
  type ForYouProgress,
  type ForYouSuggestion,
} from "../lib/forYou";
import { deskPhase, emptyDeskBeats } from "../lib/deskPhase";
import type { VoiceState } from "../lib/voice";
import {
  DismissedRow,
  ExpiredRow,
  InteractedRow,
  SkippedRow,
} from "./HistoryRows";
import { RankingDrawer } from "./RankingDrawer";
import { MissionCard, pickApproachScout, pickApproachSuggestion } from "./MissionCard";
import { useReplyPace } from "./useReplyPace";
import type { CoachingState } from "../lib/coaching";
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
  authUser: AuthSessionUser | null;
  setVoice: Dispatch<SetStateAction<VoiceState | null>>;
  actForYou: (id: string, action: "done" | "skip" | "dismiss") => void | Promise<void>;
  onOpenVoice: () => void;
  onLinkX: () => void;
  onMark: (thread: ThreadCard) => void;
  onSkip: (thread: ThreadCard) => void;
  onDismiss: (thread: ThreadCard) => void;
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
  setExpandedId,
  interactedIds,
  voice,
  agenda,
  authUser,
  setVoice,
  actForYou,
  onOpenVoice,
  onLinkX,
  onMark,
  onSkip,
  onDismiss,
}: ThreadsTabsProps) {
  const pace = useReplyPace();
  const { exitingIds, beginExit, clearGone } = useDeskRowExit();
  const scout = pickApproachScout(curatedThreads);
  const suggestion = pickApproachSuggestion(forYouSuggestions);
  const { phase, hold } = deskPhase({
    needsOnboarding: false,
    paceLocked: pace.locked,
    overheat: false,
    hasScoutCard: curatedThreads.length > 0,
    hasSuggestion: forYouSuggestions.length > 0,
    searching,
    beats: emptyDeskBeats(),
  });
  useEffect(() => {
    const live = new Set<string>();
    for (const t of curatedThreads) live.add(t.id);
    for (const row of forYouSuggestions) live.add(row.id);
    clearGone(live);
  }, [curatedThreads, forYouSuggestions, clearGone]);
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
              n={curatedThreads.length + forYouSuggestions.length}
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
          <MissionCard
            phase={phase}
            hold={hold}
            clock={pace.clock}
            onBypass={pace.bypass}
            searching={searching}
            forYouProgress={forYouProgress}
            forYouExtra={forYouExtra}
            coaching={coaching}
            requestExtra={requestExtra}
            scout={scout}
            suggestion={suggestion}
            actionBusy={actionBusy}
            setExpandedId={setExpandedId}
            interactedIds={interactedIds}
            voice={voice}
            agenda={agenda}
            authUser={authUser}
            setVoice={setVoice}
            exitingIds={exitingIds}
            onScoutMark={onMark}
            onScoutSkip={(thread) =>
              exitRow(thread.id, thread.id, () => onSkip(thread))
            }
            onScoutDismiss={onDismiss}
            onSuggestionPosted={(id) =>
              exitRow(id, `suggest:${id}`, () => actForYou(id, "done"))
            }
            onSuggestionSkip={(id) =>
              exitRow(id, `suggest:${id}`, () => actForYou(id, "skip"))
            }
            onSuggestionDismiss={(id) =>
              exitRow(id, `suggest:${id}`, () => actForYou(id, "dismiss"))
            }
            onOpenVoice={onOpenVoice}
            onLinkX={onLinkX}
          />
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
