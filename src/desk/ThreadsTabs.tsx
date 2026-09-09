import type { Dispatch, SetStateAction } from "react";
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
  interactedHydrated: boolean;
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
  dismissThread: ThreadCard | null;
  setVoice: Dispatch<SetStateAction<VoiceState | null>>;
  actForYou: (
    id: string,
    action: "done" | "skip" | "dismiss",
  ) => Promise<boolean>;
  onOpenVoice: () => void;
  onOpenSettings: () => void;
  onLinkX: () => void;
  grounded: boolean;
  searchCooldownRemaining: number;
  onSearch: () => void;
  onSkip: (thread: ThreadCard) => void | Promise<boolean>;
  onDismiss: (thread: ThreadCard) => void;
  onRefreshCoaching: (opts?: { lite?: boolean }) => void | Promise<void>;
  onHydrateInteracted: (preservedId?: string | null) => void | Promise<void>;
};

function ThreadsFeedTab(props: {
  tab: ThreadsTab;
  active: ThreadsTab;
  label: string;
  count: number;
  onSelect: (tab: ThreadsTab) => void;
}) {
  const selected = props.active === props.tab;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={selected ? "threads-tab active" : "threads-tab"}
      onClick={() => props.onSelect(props.tab)}
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
  interactedHydrated,
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
  dismissThread,
  setVoice,
  actForYou,
  onOpenVoice,
  onOpenSettings,
  onLinkX,
  grounded,
  searchCooldownRemaining,
  onSearch,
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
    interactedHistory,
    interactedHydrated,
    dismissedHistory,
    dismissThread,
    searching,
    grounded,
    searchCooldownRemaining,
    setExpandedId,
    actForYou,
    onSearch,
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
            count={interactedHistory.length}
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
      <div className="threads-scroll">
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
          interactedHistory.length === 0 ? (
            <p className="empty">
              No interacted threads yet. Scout replies appear here after you
              post on X.
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
