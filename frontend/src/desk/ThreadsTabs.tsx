import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import type { AuthSessionUser } from "../auth/types";
import { APPROACH_TAB_LABEL, type ForYouSuggestion } from "../lib/forYou";
import type { VoiceState } from "../lib/voice";
import {
  DismissedRow,
  ExpiredRow,
  InteractedRow,
  SkippedRow,
} from "./HistoryRows";
import { RankingDrawer } from "./RankingDrawer";
import { ApproachLoadingCard, MissionCard } from "./MissionCard";
import type { CoachingState } from "../lib/coaching";
import type { ScoutStageId } from "../lib/scoutStages";
import { ThreadsTabCount } from "./ThreadsTabCount";
import { useApproachTask } from "./useApproachTask";
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
  coaching?: CoachingState | null;
  interactedHistory: InteractionHistoryEntry[];
  interactedRetainedHistory: InteractionHistoryEntry[];
  interactedTotal: number;
  interactedPage: number;
  onInteractedPageChange: (page: number) => Promise<void>;
  skippedHistory: SkipHistoryEntry[];
  dismissedHistory: DismissalHistoryEntry[];
  expiredHistory: ExpiredHistoryEntry[];
  searching: boolean;
  scoutStage?: ScoutStageId | null;
  scoutLine?: string | null;
  actionBusy: boolean;
  expandedId: string | null;
  setExpandedId: Dispatch<SetStateAction<string | null>>;
  interactedIds: Set<string>;
  voice: VoiceState | null;
  agenda: string;
  agendaReady: boolean;
  deskBootReady: boolean;
  authUser: AuthSessionUser | null;
  dismissThread: ThreadCard | null;
  setVoice: Dispatch<SetStateAction<VoiceState | null>>;
  actForYou: (
    id: string,
    action: "done" | "skip" | "dismiss",
  ) => Promise<boolean | "gone">;
  onOpenVoice: () => void;
  onOpenSettings: () => void;
  onLinkX: () => void;
  onSkip: (thread: ThreadCard) => void | Promise<boolean>;
  onDismiss: (thread: ThreadCard) => void;
  onRefreshCoaching: (opts?: { lite?: boolean }) => void | Promise<void>;
  onHydrateInteracted: (preservedId?: string | null) => void | Promise<void>;
};

const THREAD_TABS: ThreadsTab[] = [
  "curated",
  "interacted",
  "skipped",
  "dismissed",
  "expired",
];

function ThreadsFeedTab(props: {
  tab: ThreadsTab;
  active: ThreadsTab;
  label: string;
  count: number;
  onSelect: (tab: ThreadsTab) => void;
}) {
  const selected = props.active === props.tab;
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const current = THREAD_TABS.indexOf(props.tab);
    let next: ThreadsTab | undefined;
    if (event.key === "ArrowRight") {
      next = THREAD_TABS[(current + 1) % THREAD_TABS.length];
    } else if (event.key === "ArrowLeft") {
      next =
        THREAD_TABS[(current - 1 + THREAD_TABS.length) % THREAD_TABS.length];
    } else if (event.key === "Home") {
      next = THREAD_TABS[0];
    } else if (event.key === "End") {
      next = THREAD_TABS[THREAD_TABS.length - 1];
    }
    if (!next) return;
    event.preventDefault();
    props.onSelect(next);
    document.getElementById(`threads-tab-${next}`)?.focus();
  }

  return (
    <button
      id={`threads-tab-${props.tab}`}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={`threads-panel-${props.tab}`}
      tabIndex={selected ? 0 : -1}
      className={selected ? "threads-tab active" : "threads-tab"}
      onClick={() => props.onSelect(props.tab)}
      onKeyDown={onKeyDown}
    >
      {props.label}
      <ThreadsTabCount n={props.count} />
    </button>
  );
}

export function ThreadsTabs({
  threadsTab,
  setThreadsTab,
  curatedThreads,
  forYouSuggestions,
  coaching,
  interactedHistory,
  interactedRetainedHistory,
  interactedTotal,
  interactedPage,
  onInteractedPageChange,
  skippedHistory,
  dismissedHistory,
  expiredHistory,
  searching,
  scoutStage,
  scoutLine,
  actionBusy,
  expandedId,
  setExpandedId,
  interactedIds,
  voice,
  agenda,
  agendaReady,
  deskBootReady,
  authUser,
  dismissThread,
  setVoice,
  actForYou,
  onOpenVoice,
  onOpenSettings,
  onLinkX,
  onSkip,
  onDismiss,
  onRefreshCoaching,
  onHydrateInteracted,
}: ThreadsTabsProps) {
  const task = useApproachTask({
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
    scoutStage,
    scoutLine,
    setExpandedId,
    actForYou,
    onSkip,
    onDismiss,
    onRefreshCoaching,
    onHydrateInteracted,
  });
  return (
    <>
      <div className="threads-pane-head">
        <div className="threads-pane-title">
          <h2 className="section-label">Threads</h2>
          {threadsTab === "curated" ? <RankingDrawer /> : null}
        </div>
        <div className="threads-tabs" role="tablist" aria-label="Thread feeds">
          <ThreadsFeedTab
            tab="curated"
            active={threadsTab}
            label={APPROACH_TAB_LABEL}
            count={task.badge}
            onSelect={setThreadsTab}
          />
          <ThreadsFeedTab
            tab="interacted"
            active={threadsTab}
            label="Interacted"
            count={interactedTotal}
            onSelect={setThreadsTab}
          />
          <ThreadsFeedTab
            tab="skipped"
            active={threadsTab}
            label="Skipped"
            count={skippedHistory.length}
            onSelect={setThreadsTab}
          />
          <ThreadsFeedTab
            tab="dismissed"
            active={threadsTab}
            label="Not interested"
            count={dismissedHistory.length}
            onSelect={setThreadsTab}
          />
          <ThreadsFeedTab
            tab="expired"
            active={threadsTab}
            label="Expired"
            count={expiredHistory.length}
            onSelect={setThreadsTab}
          />
        </div>
      </div>
      {THREAD_TABS.filter((tab) => tab !== threadsTab).map((tab) => (
        <div
          key={tab}
          id={`threads-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`threads-tab-${tab}`}
          hidden
        />
      ))}
      <div
        id={`threads-panel-${threadsTab}`}
        className="threads-scroll"
        role="tabpanel"
        aria-labelledby={`threads-tab-${threadsTab}`}
      >
        {threadsTab === "curated" ? (
          !agendaReady || !task.ready ? (
            <ApproachLoadingCard />
          ) : (
            <MissionCard
              {...task.cardInput}
              clock={task.clock}
              onBypass={task.onBypass}
              onOpenSettings={onOpenSettings}
              actionBusy={actionBusy}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              interactedIds={interactedIds}
              voice={voice}
              agenda={agenda}
              authUser={authUser}
              setVoice={setVoice}
              exitingIds={task.exitingIds}
              onScoutSkip={task.onScoutSkip}
              onScoutDismiss={task.onScoutDismiss}
              onScoutNext={task.onScoutNext}
              onSuggestionPosted={task.onSuggestionPosted}
              onSuggestionSkip={task.onSuggestionSkip}
              onSuggestionDismiss={task.onSuggestionDismiss}
              onForYouNext={task.onForYouNext}
              onOpenVoice={onOpenVoice}
              onLinkX={onLinkX}
            />
          )
        ) : threadsTab === "interacted" ? (
          interactedTotal === 0 ? (
            <p className="empty">
              No interacted threads yet. Scout replies appear here after you
              post on X.
            </p>
          ) : (
            <div className="history-list">
              {interactedTotal > 10 ? (
                <nav className="interacted-pagination" aria-label="Interacted pages">
                  <button type="button" className="ghost" disabled={interactedPage <= 1}
                    onClick={() => { onInteractedPageChange(interactedPage - 1).catch(console.error); }}>
                    Previous
                  </button>
                  <span aria-live="polite">Page {interactedPage} of {Math.ceil(interactedTotal / 10)}</span>
                  <button type="button" className="ghost" disabled={interactedPage >= Math.ceil(interactedTotal / 10)}
                    onClick={() => { onInteractedPageChange(interactedPage + 1).catch(console.error); }}>
                    Next
                  </button>
                </nav>
              ) : null}
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
