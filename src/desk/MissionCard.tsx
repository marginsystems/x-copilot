import type { Dispatch, SetStateAction } from "react";
import { SuggestLocked } from "../VoiceCard";
import { SuggestPane } from "../SuggestPane";
import type { AuthSessionUser } from "../auth/types";
import {
  approachEmptyCopy,
  extraButtonLabel,
  extrasUnlocked,
  type ForYouExtraUsage,
  type ForYouProgress,
  type ForYouSuggestion,
} from "../lib/forYou";
import type { CoachingState } from "../lib/coaching";
import type { DeskPhase } from "../lib/deskPhase";
import { sortThreadsByCreatedAtNewest } from "../lib/threadSort";
import type { VoiceState } from "../lib/voice";
import { ReplyPaceBar } from "./ReplyPaceBar";
import { SuggestedRow } from "./SuggestedRow";
import { ThreadRow } from "./ThreadRow";
import type { ThreadCard } from "./types";
import { watchDeskThreads } from "./watch";

export function pickApproachSuggestion(
  rows: ForYouSuggestion[],
): ForYouSuggestion | null {
  return rows.find((row) => row.kind === "reply") ?? rows[0] ?? null;
}

export function pickApproachScout(threads: ThreadCard[]): ThreadCard | null {
  return sortThreadsByCreatedAtNewest(threads)[0] ?? null;
}

function phaseVerb(
  phase: DeskPhase,
  suggestion?: ForYouSuggestion | null,
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
  if (phase === "organic_reply") return "Organic reply";
  if (phase === "fork") return "Fork";
  if (phase === "original") return "Original";
  if (phase === "silent_refuel") return "Refuel";
  if (phase === "done_for_now") return "Done";
  return "Desk";
}

function phaseWhy(
  phase: DeskPhase,
  coaching?: CoachingState | null,
  suggestion?: ForYouSuggestion | null,
): string {
  if (phase === "organic_reply" && suggestion?.kind === "post") {
    return "Compose an original. Mark it here.";
  }
  if (phase === "organic_reply" && suggestion?.kind === "quote") {
    return "Quote something you actually read. Mark it here.";
  }
  if (phase === "organic_reply" && suggestion?.kind === "repost") {
    return "Repost something you actually read. Mark it here.";
  }
  const action = coaching?.nextAction;
  const line = action?.text?.trim();
  const takeoffOnReply =
    action?.kind === "takeoff" &&
    (phase === "scout_reply" || phase === "organic_reply");
  if (line && !takeoffOnReply) return line;
  if (phase === "scout_reply") {
    return "Reply to this thread. Then mark it.";
  }
  if (phase === "organic_reply") {
    return "Open X. Reply to something you actually read. Mark it here.";
  }
  if (phase === "fork") {
    return "Write an original, or one more reply.";
  }
  if (phase === "original") {
    return "Compose one original.";
  }
  if (phase === "done_for_now") {
    return "You're clean. History is a log.";
  }
  return "";
}

export function MissionCard(props: {
  phase: DeskPhase;
  hold: boolean;
  clock: string;
  onBypass: () => void;
  searching: boolean;
  forYouProgress?: ForYouProgress | null;
  forYouExtra?: ForYouExtraUsage | null;
  coaching?: CoachingState | null;
  requestExtra?: () => void | Promise<void>;
  scout: ThreadCard | null;
  suggestion: ForYouSuggestion | null;
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
  onOpenVoice: () => void;
  onLinkX: () => void;
}) {
  if (props.phase === "needs_onboarding") return null;

  const extra =
    props.forYouExtra && extrasUnlocked(props.forYouProgress) ? (
      <div className="for-you-extra">
        <button
          type="button"
          className="for-you-extra-btn"
          disabled={props.actionBusy || !props.forYouExtra.canExtra}
          onClick={() => void props.requestExtra?.()}
        >
          {extraButtonLabel(props.forYouExtra)}
        </button>
      </div>
    ) : null;

  if (props.hold || props.phase === "hold") {
    return (
      <div className="mission-card">
        <p className="mission-card-verb">{phaseVerb("hold")}</p>
        <ReplyPaceBar clock={props.clock} onBypass={props.onBypass} />
        {extra}
      </div>
    );
  }

  if (props.phase === "silent_refuel") {
    const why = phaseWhy(props.phase, props.coaching);
    return (
      <div className="mission-card">
        <p className="mission-card-verb">{phaseVerb(props.phase)}</p>
        {why ? (
          <p className="mission-card-why">{why}</p>
        ) : (
          <p className="empty">
            {approachEmptyCopy({
              searching: props.searching,
              progress: props.forYouProgress,
            })}
          </p>
        )}
        {extra}
      </div>
    );
  }

  if (props.phase === "scout_reply" && props.scout) {
    const thread = props.scout;
    const why = phaseWhy(props.phase, props.coaching);
    return (
      <div className="mission-card">
        <p className="mission-card-verb">{phaseVerb(props.phase)}</p>
        {why ? <p className="mission-card-why">{why}</p> : null}
        <div className="threads">
          <ThreadRow
            key={thread.id}
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
        </div>
        {extra}
      </div>
    );
  }

  if (props.phase === "organic_reply") {
    const row = props.suggestion;
    const why = phaseWhy(props.phase, props.coaching, row);
    const key = row ? `suggest:${row.id}` : null;
    return (
      <div className="mission-card">
        <p className="mission-card-verb">
          {phaseVerb(props.phase, row)}
        </p>
        {why ? <p className="mission-card-why">{why}</p> : null}
        {row && key ? (
          <div className="threads">
            <SuggestedRow
              key={row.id}
              row={row}
              index={0}
              open
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
        {extra}
      </div>
    );
  }

  const why = phaseWhy(props.phase, props.coaching);
  return (
    <div className="mission-card">
      <p className="mission-card-verb">{phaseVerb(props.phase)}</p>
      {why ? <p className="mission-card-why">{why}</p> : null}
      {extra}
    </div>
  );
}
