import type { Dispatch, ReactNode, SetStateAction } from "react";
import { SuggestLocked } from "../VoiceCard";
import { SuggestPane } from "../SuggestPane";
import type { AuthSessionUser } from "../auth/types";
import type { ForYouSuggestion } from "../lib/forYou";
import type { CoachingState } from "../lib/coaching";
import type { ApproachLock, DeskPhase } from "../lib/deskPhase";
import {
  scoutRefillPending,
  type ScoutRefillState,
} from "../lib/deskRefuel";
import { phaseWhy } from "../lib/phaseWhy";
import type { VoiceState } from "../lib/voice";
import {
  ApproachFlightRow,
  ApproachFrame,
} from "./ApproachFrame";
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

export function approachRefillLine(
  state: ScoutRefillState,
  flightLine?: string | null,
): string {
  if (state === "queued") return "Scout is queued for takeoff.";
  if (state === "waiting") return "Scout is waiting for the cooldown.";
  if (state === "flying") return flightLine || "In the air…";
  if (state === "landed") return "Scout landed. Loading Approach.";
  return "You're clean. History is a log.";
}

function phaseVerb(
  phase: DeskPhase,
  suggestion?: ForYouSuggestion | null,
  scouting = false,
): string {
  if (phase === "hold") return "Hold";
  if (phase === "scout_reply") return "Reply";
  if (phase === "organic_reply" && suggestion?.kind === "post") {
    return "Original";
  }
  if (phase === "organic_reply" && suggestion?.kind === "quote") {
    return "Quote";
  }
  if (phase === "organic_reply" && suggestion?.kind === "repost") {
    return "Repost";
  }
  if (phase === "organic_reply") return "Suggested reply";
  if (phase === "silent_refuel") return "For You";
  if (phase === "done_for_now") return scouting ? "Scouting" : "Desk";
  return "Desk";
}

export function MissionCard(props: {
  phase: DeskPhase;
  hold: boolean;
  clock: string;
  remainingMs: number;
  onBypass: () => void;
  groundedLine?: string | null;
  silentCard?: ApproachLock["surface"];
  forYouStatus?: string;
  onOpenUsage?: () => void;
  onOpenSettings?: () => void;
  coaching?: CoachingState | null;
  scout: ThreadCard | null;
  suggestion: ForYouSuggestion | null;
  refillState: ScoutRefillState;
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
  onSuggestionPosted: (id: string) => void;
  onSuggestionSkip: (id: string) => void;
  onSuggestionDismiss: (id: string) => void;
  onForYouNext?: () => void;
  onOpenVoice: () => void;
  onLinkX: () => void;
  flightLine?: string | null;
}) {
  if (props.phase === "needs_onboarding") return null;

  const withReplyPace = (card: ReactNode) => (
    <>
      {card}
      {props.remainingMs > 0 ? (
        <ReplyPaceBar
          clock={props.clock}
          remainingMs={props.remainingMs}
          onBypass={props.onBypass}
        />
      ) : null}
    </>
  );

  if (props.hold || props.phase === "hold") {
    return withReplyPace(
      <div className="mission-card">
        <p className="mission-card-verb">{phaseVerb("hold")}</p>
        <div className="threads">
          <ForYouFeedRow
            status={props.forYouStatus}
            onNext={props.onForYouNext}
          />
        </div>
      </div>
    );
  }

  if (props.phase === "silent_refuel") {
    const action = props.silentCard ?? "wait";
    let why = "";
    if (action === "link_x") {
      why = "Link X so Scout can refuel Approach.";
    } else if (action === "settings") {
      why = "Set an agenda in Settings so Scout knows what to look for.";
    } else if (action === "usage") {
      why =
        props.groundedLine ||
        "Grounded. Scout waits until 00:00 UTC. Open Usage for the next plan.";
    } else if (action === "wait") {
      why = "Approach is holding.";
    }
    return withReplyPace(
      <div className="mission-card">
        <p className="mission-card-verb">{phaseVerb(props.phase)}</p>
        <p className="mission-card-why">{why}</p>
        {action === "link_x" ? (
          <div className="row">
            <button type="button" className="primary" onClick={props.onLinkX}>
              Link X
            </button>
          </div>
        ) : null}
        {action === "settings" ? (
          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={props.onOpenSettings}
            >
              Settings
            </button>
          </div>
        ) : null}
        {action === "usage" ? (
          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={props.onOpenUsage}
            >
              Usage & Billing
            </button>
          </div>
        ) : null}
        {action === "for_you" ? (
          <div className="threads">
            <ForYouFeedRow
              status={props.forYouStatus}
              onNext={props.onForYouNext}
            />
          </div>
        ) : null}
      </div>
    );
  }

  if (
    (props.phase === "scout_reply" && props.scout) ||
    props.phase === "done_for_now"
  ) {
    const thread =
      props.phase === "scout_reply" || props.phase === "done_for_now"
        ? props.scout
        : null;
    const refillPending = scoutRefillPending(props.refillState);
    const why = phaseWhy(props.phase, props.coaching);
    return withReplyPace(
      <ApproachFrame
        verb={phaseVerb(props.phase, null, refillPending)}
        why={why}
        busy={!thread && props.refillState !== "terminal_empty"}
      >
        {thread ? (
          <ThreadRow
            thread={thread}
            index={0}
            open={props.expandedId === thread.id}
            exiting={props.exitingIds.has(thread.id)}
            busy={props.actionBusy}
            interacted={props.interactedIds.has(thread.id)}
            onToggle={() =>
              props.setExpandedId((id) => (id === thread.id ? null : thread.id))
            }
            onWatch={() => watchDeskThreads([thread])}
            showMark={false}
            onMark={() => props.onScoutMark(thread)}
            onSkip={() => props.onScoutSkip(thread)}
            onDismiss={() => props.onScoutDismiss(thread)}
            suggest={
              props.voice?.status === "ready" && props.voice.unlocked ? (
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
              ) : (
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
        ) : (
          <ApproachFlightRow
            line={approachRefillLine(props.refillState, props.flightLine)}
            flying={refillPending}
          />
        )}
      </ApproachFrame>
    );
  }

  if (props.phase === "organic_reply") {
    const row = props.suggestion;
    const why = phaseWhy(props.phase, props.coaching, row);
    const key = row ? `suggest:${row.id}` : null;
    return withReplyPace(
      <div className="mission-card">
        <p className="mission-card-verb">
          {phaseVerb(props.phase, row)}
        </p>
        <p className="mission-card-why">{why}</p>
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

  const refillPending = scoutRefillPending(props.refillState);
  const why = phaseWhy(props.phase, props.coaching);
  return withReplyPace(
    <div className="mission-card">
      <p className="mission-card-verb">
        {phaseVerb(props.phase, null, refillPending)}
      </p>
      <p className="mission-card-why">{why}</p>
    </div>
  );
}
