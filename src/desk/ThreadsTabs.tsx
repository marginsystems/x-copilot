import type { Dispatch, SetStateAction } from "react";
import { SuggestPane } from "../SuggestPane";
import { SuggestLocked } from "../VoiceCard";
import type { AuthSessionUser } from "../auth/types";
import {
  APPROACH_TAB_LABEL,
  approachEmptyCopy,
  type ForYouProgress,
  type ForYouSuggestion,
} from "../lib/forYou";
import { sortThreadsByCreatedAtNewest } from "../lib/threadSort";
import type { VoiceState } from "../lib/voice";
import {
  DismissedRow,
  ExpiredRow,
  InteractedRow,
  SkippedRow,
} from "./HistoryRows";
import { RankingDrawer } from "./RankingDrawer";
import { SuggestedRow } from "./SuggestedRow";
import { ThreadRow } from "./ThreadRow";
import { ThreadsTabCount } from "./ThreadsTabCount";
import type {
  DismissalHistoryEntry,
  ExpiredHistoryEntry,
  InteractionHistoryEntry,
  SkipHistoryEntry,
  ThreadCard,
  ThreadsTab,
} from "./types";
import { watchDeskThreads } from "./watch";

type ThreadsTabsProps = {
  threadsTab: ThreadsTab;
  setThreadsTab: (tab: ThreadsTab) => void;
  curatedThreads: ThreadCard[];
  forYouSuggestions: ForYouSuggestion[];
  forYouProgress?: ForYouProgress | null;
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
  authUser,
  setVoice,
  actForYou,
  onOpenVoice,
  onLinkX,
  onMark,
  onSkip,
  onDismiss,
}: ThreadsTabsProps) {
  return (
    <>
      <div className="threads-pane-head">
        <h2 className="section-label">Threads</h2>
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
      {threadsTab === "curated" ? <RankingDrawer /> : null}
      <div className="threads-scroll">
        {threadsTab === "curated" ? (
          curatedThreads.length === 0 &&
          forYouSuggestions.length === 0 ? (
            <p className="empty">
              {approachEmptyCopy({
                searching,
                progress: forYouProgress,
              })}
            </p>
          ) : (
            <div className="threads">
              {forYouSuggestions.length > 0 ? (
                <div className="for-you-suggested">
                  <h3 className="section-label">Suggested</h3>
                  {forYouSuggestions.map((row) => {
                    const key = `suggest:${row.id}`;
                    return (
                      <SuggestedRow
                        key={row.id}
                        row={row}
                        open={expandedId === key}
                        busy={actionBusy}
                        voice={voice}
                        agenda={agenda}
                        xLinked={authUser?.xLinked}
                        hasSession={Boolean(authUser)}
                        onToggle={() =>
                          setExpandedId((id) => (id === key ? null : key))
                        }
                        onPosted={() => void actForYou(row.id, "done")}
                        onSkip={() => void actForYou(row.id, "skip")}
                        onDismiss={() => void actForYou(row.id, "dismiss")}
                        onOpenSettings={onOpenVoice}
                        onLinkX={onLinkX}
                        onUsage={(u) =>
                          setVoice((v) => (v ? { ...v, suggests: u } : v))
                        }
                      />
                    );
                  })}
                </div>
              ) : null}
              {sortThreadsByCreatedAtNewest(curatedThreads).map((t) => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  open={expandedId === t.id}
                  busy={actionBusy}
                  interacted={interactedIds.has(t.id)}
                  onToggle={() => {
                    const next = expandedId === t.id ? null : t.id;
                    setExpandedId(next);
                    if (next) watchDeskThreads([t]);
                  }}
                  onWatch={() => watchDeskThreads([t])}
                  onMark={() => onMark(t)}
                  onSkip={() => void onSkip(t)}
                  onDismiss={() => onDismiss(t)}
                  suggest={
                    voice?.status === "ready" && voice.unlocked ? (
                      <SuggestPane
                        threadId={t.id}
                        author={t.author}
                        text={t.text}
                        opAuthor={t.opAuthor}
                        opText={t.opText}
                        threadKind={t.threadKind}
                        flags={t.flags}
                        agenda={agenda}
                        usage={voice.suggests}
                        onUsage={(u) =>
                          setVoice((v) =>
                            v ? { ...v, suggests: u } : v,
                          )
                        }
                        onOpenIntent={() => watchDeskThreads([t])}
                      />
                    ) : (
                      <SuggestLocked
                        voice={voice}
                        xLinked={authUser?.xLinked}
                        hasSession={Boolean(authUser)}
                        onOpenSettings={onOpenVoice}
                        onLinkX={onLinkX}
                      />
                    )
                  }
                />
              ))}
            </div>
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
