import { ApproachFlightRow, ApproachFrame } from "./ApproachFrame";
import { DeskRow } from "./DeskRow";
import {
  presentApproach,
  type ApproachCardInput,
  type ApproachPresentation,
} from "../../../shared/src/approachPresenter";
import { ForYouFeedRow } from "./ForYouFeedRow";
import type { OpenPace } from "./RowOpen";
import { SuggestedRow } from "./SuggestedRow";
import { ThreadRow } from "./ThreadRow";
import type { ThreadCard } from "../../../shared/src/deskTypes";
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
  onOpenSettings?: () => void;
  actionBusy: boolean;
  interactedIds: Set<string>;
  exitingIds: Set<string>;
  onScoutSkip: (thread: ThreadCard) => void;
  onScoutDismiss: (thread: ThreadCard) => void;
  onScoutNext?: () => void;
  onSuggestionPosted: (id: string) => void;
  onSuggestionSkip: (id: string) => void;
  onSuggestionDismiss: (id: string) => void;
  onForYouNext?: () => void;
  onLinkX: () => void;
};

function ScoutRow(
  props: MissionCardProps & { thread: ThreadCard; openPace: OpenPace | null },
) {
  const { thread } = props;
  return (
    <ThreadRow
      thread={thread}
      index={0}
      exiting={props.exitingIds.has(thread.id)}
      busy={props.actionBusy}
      interacted={props.scoutDetected}
      detecting={!props.scoutDetected}
      onWatch={() => watchDeskThreads([thread])}
      openPace={props.openPace}
      onSkip={() => props.onScoutSkip(thread)}
      onDismiss={() => props.onScoutDismiss(thread)}
      onNext={props.onScoutNext}
    />
  );
}

function GateCard(props: MissionCardProps & { view: ApproachPresentation }) {
  const { view } = props;
  return (
    <ApproachFrame>
      <DeskRow
        className="approach-gate-row"
        lead={view.gate === "link_x" ? "X" : "SET"}
        leadTitle={view.verb}
        summary={
          <>
            <strong>{view.verb}</strong>
            {" — "}
            {view.why}
          </>
        }
        onPrimary={
          view.gate === "link_x" ? props.onLinkX : props.onOpenSettings
        }
        primaryLabel={view.gate === "link_x" ? "Link X" : "Settings"}
      />
    </ApproachFrame>
  );
}

function SuggestedCard(
  props: MissionCardProps & {
    view: ApproachPresentation;
    openPace: OpenPace | null;
  },
) {
  const row = props.suggestion;
  return (
    <ApproachFrame>
      {row ? (
        <div className="threads">
          <SuggestedRow
            key={row.id}
            row={row}
            index={0}
            exiting={props.exitingIds.has(row.id)}
            busy={props.actionBusy}
            interacted={props.suggestionDetected}
            detecting={props.view.detector === "scout"}
            openPace={props.openPace}
            onPosted={() => props.onSuggestionPosted(row.id)}
            onNext={() => props.onSuggestionPosted(row.id)}
            onSkip={() => props.onSuggestionSkip(row.id)}
            onDismiss={() => props.onSuggestionDismiss(row.id)}
          />
        </div>
      ) : null}
    </ApproachFrame>
  );
}

/**
 * Renders the locked task from the shared presenter. Refill state, inventory
 * arrivals, and detection never change the card here; only the lock does.
 */
export function MissionCard(props: MissionCardProps) {
  const view = presentApproach(props);
  if (view.kind === "blank") return null;

  const openPace: OpenPace | null = view.showPace
    ? { remainingMs: props.remainingMs, clock: props.clock }
    : null;

  if (view.kind === "gate") {
    return <GateCard {...props} view={view} />;
  }

  if (view.kind === "for_you" && view.forYou) {
    return (
      <ApproachFrame>
        <ForYouFeedRow
          status={view.forYou.status}
          detected={view.forYou.detected}
          activity={view.forYou.activity}
          onNext={view.forYou.showNext ? props.onForYouNext : undefined}
          openPace={openPace}
        />
      </ApproachFrame>
    );
  }

  if (view.kind === "scout" && props.scout) {
    return (
      <ApproachFrame>
        <ScoutRow {...props} thread={props.scout} openPace={openPace} />
      </ApproachFrame>
    );
  }

  if (view.kind === "scout_missing") {
    return (
      <ApproachFrame verb={view.verb} busy>
        <ApproachFlightRow
          line={view.why}
          verb={view.verb}
          flying={props.searching === true}
          onNext={view.showNext ? props.onScoutNext : undefined}
        />
      </ApproachFrame>
    );
  }

  return <SuggestedCard {...props} view={view} openPace={openPace} />;
}
