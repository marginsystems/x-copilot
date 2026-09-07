import type { Dispatch, ReactNode, SetStateAction } from "react";
import { SuggestLocked } from "../VoiceCard";
import { SuggestPane } from "../SuggestPane";
import type { AuthSessionUser } from "../auth/types";
import type { VoiceState } from "../lib/voice";
import { ApproachFlightRow, ApproachFrame } from "./ApproachFrame";
import {
  presentApproach,
  type ApproachCardInput,
  type ApproachPresentation,
} from "./approachPresenter";
import { ForYouFeedRow } from "./ForYouFeedRow";
import { ReplyPaceBar } from "./ReplyPaceBar";
import { SuggestedRow } from "./SuggestedRow";
import { ThreadRow } from "./ThreadRow";
import type { ThreadCard } from "./types";
import { watchDeskThreads } from "./watch";

export { pickApproachSuggestion } from "../lib/approachCard";
export { pickApproachScout } from "./approachScout";

export function ApproachLoadingCard() {
  return (
    <div
      className="approach-panel-loader"
      role="status"
      aria-busy="true"
      aria-label="Loading Approach"
    >
      <span className="approach-panel-loader-mark" aria-hidden="true" />
    </div>
  );
}

export type MissionCardProps = ApproachCardInput & {
  clock: string;
  onBypass: () => void;
  onOpenSettings?: () => void;
  actionBusy: boolean;
  expandedId: string | null;
  setExpandedId: Dispatch<SetStateAction<string | null>>;
  interactedIds: Set<string>;
  voice: VoiceState | null;
  agenda: string;
  authUser: AuthSessionUser | null;
  setVoice: Dispatch<SetStateAction<VoiceState | null>>;
  exitingIds: Set<string>;
  onScoutMark: (thread: ThreadCard) => void;
  onScoutSkip: (thread: ThreadCard) => void;
  onScoutDismiss: (thread: ThreadCard) => void;
  onScoutNext?: () => void;
  onSuggestionPosted: (id: string) => void;
  onSuggestionSkip: (id: string) => void;
  onSuggestionDismiss: (id: string) => void;
  onForYouNext?: () => void;
  onOpenVoice: () => void;
  onLinkX: () => void;
};

function ScoutRow(props: MissionCardProps & { thread: ThreadCard }) {
  const { thread } = props;
  return (
    <ThreadRow
      thread={thread}
      index={0}
      open={props.expandedId === thread.id}
      exiting={props.exitingIds.has(thread.id)}
      busy={props.actionBusy}
      interacted={props.scoutDetected}
      onToggle={() =>
        props.setExpandedId((id) => (id === thread.id ? null : thread.id))
      }
      onWatch={() => watchDeskThreads([thread])}
      showMark={false}
      onMark={() => props.onScoutMark(thread)}
      onSkip={() => props.onScoutSkip(thread)}
      onDismiss={() => props.onScoutDismiss(thread)}
      onNext={props.onScoutNext}
      suggest={
        thread.surface === "repost"
          ? undefined
          : props.voice?.status === "ready" && props.voice.unlocked
            ? (
                <SuggestPane
                  threadId={thread.id}
                  author={thread.author}
                  text={thread.text}
                  opAuthor={thread.opAuthor}
                  opText={thread.opText}
                  threadKind={thread.threadKind}
                  flags={thread.flags}
                  agenda={props.agenda}
                  usage={props.voice.suggests}
                  onUsage={(u) =>
                    props.setVoice((v) => (v ? { ...v, suggests: u } : v))
                  }
                  onOpenIntent={() => watchDeskThreads([thread])}
                />
              )
            : (
                <SuggestLocked
                  voice={props.voice}
                  xLinked={props.authUser?.xLinked}
                  hasSession={Boolean(props.authUser)}
                  onOpenSettings={props.onOpenVoice}
                  onLinkX={props.onLinkX}
                />
              )
      }
    />
  );
}

function GateCard(props: MissionCardProps & { view: ApproachPresentation }) {
  const { view } = props;
  return (
    <div className="mission-card">
      <p className="mission-card-verb">{view.verb}</p>
      <p className="mission-card-why">{view.why}</p>
      <div className="row">
        {view.gate === "link_x" ? (
          <button type="button" className="primary" onClick={props.onLinkX}>
            Link X
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={props.onOpenSettings}
          >
            Settings
          </button>
        )}
      </div>
    </div>
  );
}

function SuggestedCard(
  props: MissionCardProps & { view: ApproachPresentation },
) {
  const row = props.suggestion;
  const key = row ? `suggest:${row.id}` : null;
  return (
    <div className="mission-card">
      <p className="mission-card-verb">{props.view.verb}</p>
      <p className="mission-card-why">{props.view.why}</p>
      {row && key ? (
        <div className="threads">
          <SuggestedRow
            key={row.id}
            row={row}
            index={0}
            open={props.expandedId === key}
            exiting={props.exitingIds.has(row.id)}
            busy={props.actionBusy}
            voice={props.voice}
            agenda={props.agenda}
            xLinked={props.authUser?.xLinked}
            hasSession={Boolean(props.authUser)}
            onToggle={() =>
              props.setExpandedId((id) => (id === key ? null : key))
            }
            onPosted={() => props.onSuggestionPosted(row.id)}
            onSkip={() => props.onSuggestionSkip(row.id)}
            onDismiss={() => props.onSuggestionDismiss(row.id)}
            onOpenSettings={props.onOpenVoice}
            onLinkX={props.onLinkX}
            onUsage={(u) =>
              props.setVoice((v) => (v ? { ...v, suggests: u } : v))
            }
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders the locked task from the shared presenter. Refill state, inventory
 * arrivals, and detection never change the card here; only the lock does.
 */
export function MissionCard(props: MissionCardProps) {
  const view = presentApproach(props);
  if (view.kind === "blank") return null;

  const withReplyPace = (card: ReactNode) => (
    <>
      {card}
      {view.showPace ? (
        <ReplyPaceBar
          clock={props.clock}
          remainingMs={props.remainingMs}
          onBypass={props.onBypass}
        />
      ) : null}
    </>
  );

  if (view.kind === "gate") {
    return withReplyPace(<GateCard {...props} view={view} />);
  }

  if (view.kind === "for_you" && view.forYou) {
    return withReplyPace(
      <ApproachFrame verb={view.verb} why={view.why}>
        <ForYouFeedRow
          status={view.forYou.status}
          detected={view.forYou.detected}
          actionCopy={view.forYou.actionCopy}
          onNext={view.forYou.showNext ? props.onForYouNext : undefined}
          expandable={false}
        />
      </ApproachFrame>,
    );
  }

  if (view.kind === "scout" && props.scout) {
    return withReplyPace(
      <ApproachFrame verb={view.verb} why={view.why}>
        <ScoutRow {...props} thread={props.scout} />
      </ApproachFrame>,
    );
  }

  if (view.kind === "scout_missing") {
    return withReplyPace(
      <ApproachFrame verb={view.verb} why={view.why} busy>
        <ApproachFlightRow line={view.why} flying={false} />
      </ApproachFrame>,
    );
  }

  return withReplyPace(<SuggestedCard {...props} view={view} />);
}
