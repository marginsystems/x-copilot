import type { Dispatch, SetStateAction } from "react";
import { SuggestLocked } from "../VoiceCard";
import { SuggestPane } from "../SuggestPane";
import type { AuthSessionUser } from "../auth/types";
import {
  extraButtonLabel,
  FYP_WAIT_COPY,
  showApproachExtra,
  X_FOR_YOU_URL,
  type ForYouExtraUsage,
  type ForYouProgress,
  type ForYouSuggestion,
} from "../lib/forYou";
import type { CoachingState } from "../lib/coaching";
import { deskNeedsXLink } from "../lib/deskGate";
import { AGENDA_MIN_CHARS } from "../lib/agendaPersist";
import type { DeskPhase } from "../lib/deskPhase";
import { preferRootTargets } from "../lib/scoutTarget";
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
  return preferRootTargets(threads)[0] ?? null;
}

export function ApproachLoadingCard() {
  return (
    <div
      className="mission-card mission-card-is-loading"
      aria-busy="true"
      role="status"
    >
      <p className="mission-card-verb">Approach</p>
      <p className="mission-card-why">Loading the next action.</p>
      <div className="mission-card-skel" aria-hidden="true">
        <span className="mission-skel mission-skel-why" />
        <span className="mission-skel mission-skel-row" />
        <span className="mission-skel mission-skel-row mission-skel-short" />
      </div>
    </div>
  );
}

export function pickApproachOriginal(
  rows: ForYouSuggestion[],
): ForYouSuggestion | null {
  return rows.find((row) => row.kind === "post") ?? null;
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
  if (phase === "silent_refuel") return "For You";
  if (phase === "done_for_now") return "Done";
  return "Desk";
}

function phaseWhy(
  phase: DeskPhase,
  coaching?: CoachingState | null,
  suggestion?: ForYouSuggestion | null,
): string {
  if (phase === "done_for_now") {
    return "You're clean. History is a log.";
  }
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
  return "";
}

export function MissionCard(props: {
  phase: DeskPhase;
  hold: boolean;
  clock: string;
  onBypass: () => void;
  searching: boolean;
  grounded?: boolean;
  groundedLine?: string | null;
  cooldownRemaining?: number;
  onStopScout?: () => void;
  onOpenUsage?: () => void;
  onOpenSettings?: () => void;
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
  onChooseFork: (choice: "original" | "reply") => void;
  onOriginalPosted: () => void;
  onOpenVoice: () => void;
  onLinkX: () => void;
}) {
  if (props.phase === "needs_onboarding") return null;

  const extra = showApproachExtra({
    extra: props.forYouExtra,
    progress: props.forYouProgress,
    phase: props.phase,
    hasLiveCard: Boolean(props.scout || props.suggestion),
  })
    ? (
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={props.actionBusy}
          onClick={() => void props.requestExtra?.()}
        >
          {extraButtonLabel(props.forYouExtra!)}
        </button>
      </div>
    )
    : null;

  if (props.hold || props.phase === "hold") {
    return (
      <div className="mission-card">
        <p className="mission-card-verb">{phaseVerb("hold")}</p>
        <p className="mission-card-why">{FYP_WAIT_COPY}</p>
        <ReplyPaceBar clock={props.clock} onBypass={props.onBypass} />
        <div className="row">
          <a
            className="primary"
            href={X_FOR_YOU_URL}
            target="_blank"
            rel="noreferrer"
          >
            Open For You
          </a>
        </div>
      </div>
    );
  }

  if (props.phase === "silent_refuel") {
    const needsX = deskNeedsXLink(props.authUser);
    const hasAgenda = props.agenda.trim().length >= AGENDA_MIN_CHARS;
    let why = "";
    let action: "link_x" | "settings" | "usage" | "fyp" | null = null;
    if (needsX) {
      why = "Link X so Scout can refuel Approach.";
      action = "link_x";
    } else if (!hasAgenda) {
      why = "Set an agenda in Settings so Scout knows what to look for.";
      action = "settings";
    } else if (props.grounded) {
      why =
        props.groundedLine ||
        "Grounded. Scout waits until 00:00 UTC. Open Usage for the next plan.";
      action = "usage";
    } else if ((props.cooldownRemaining ?? 0) > 0) {
      why = `Hold short ${props.cooldownRemaining}s. Scout retries after the gate.`;
    } else {
      why = FYP_WAIT_COPY;
      action = "fyp";
    }
    return (
      <div className="mission-card">
        <p className="mission-card-verb">{phaseVerb(props.phase)}</p>
        {why ? <p className="mission-card-why">{why}</p> : null}
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
        {action === "fyp" ? (
          <div className="row">
            <a
              className="primary"
              href={X_FOR_YOU_URL}
              target="_blank"
              rel="noreferrer"
            >
              Open For You
            </a>
            {props.searching ? (
              <button
                type="button"
                className="ghost"
                onClick={props.onStopScout}
              >
                Land
              </button>
            ) : null}
          </div>
        ) : null}
        {action === null ? extra : null}
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
      </div>
    );
  }

  if (props.phase === "fork") {
    const why = phaseWhy(props.phase, props.coaching);
    return (
      <div className="mission-card">
        <p className="mission-card-verb">{phaseVerb(props.phase)}</p>
        {why ? <p className="mission-card-why">{why}</p> : null}
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={props.actionBusy}
            onClick={() => props.onChooseFork("original")}
          >
            Original
          </button>
          <button
            type="button"
            className="ghost"
            disabled={props.actionBusy}
            onClick={() => props.onChooseFork("reply")}
          >
            Another reply
          </button>
        </div>
      </div>
    );
  }

  if (
    props.phase === "organic_reply" ||
    (props.phase === "original" && props.suggestion?.kind === "post")
  ) {
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

  const why = phaseWhy(props.phase, props.coaching);
  return (
    <div className="mission-card">
      <p className="mission-card-verb">{phaseVerb(props.phase)}</p>
      {why ? <p className="mission-card-why">{why}</p> : null}
      {props.phase === "original" ? (
        <div className="row">
          <a
            className="primary"
            href="https://x.com/intent/tweet"
            target="_blank"
            rel="noreferrer"
          >
            Open X
          </a>
          <button
            type="button"
            className="ghost"
            disabled={props.actionBusy}
            onClick={props.onOriginalPosted}
          >
            I posted on X
          </button>
        </div>
      ) : null}
    </div>
  );
}
