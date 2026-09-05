import type { Dispatch, SetStateAction } from "react";
import { SuggestLocked } from "../VoiceCard";
import { SuggestPane } from "../SuggestPane";
import type { AuthSessionUser } from "../auth/types";
import {
  extraButtonLabel,
  showApproachExtra,
  type ForYouExtraUsage,
  type ForYouProgress,
  type ForYouSuggestion,
} from "../lib/forYou";
import type { CoachingState } from "../lib/coaching";
import type { ApproachLock, DeskPhase } from "../lib/deskPhase";
import { approachCollectingCopy, phaseWhy } from "../lib/phaseWhy";
import { preferRootTargets } from "../lib/scoutTarget";
import type { VoiceState } from "../lib/voice";
import { ForYouFeedRow } from "./ForYouFeedRow";
import { ReplyPaceBar } from "./ReplyPaceBar";
import { SuggestedRow } from "./SuggestedRow";
import { ThreadRow } from "./ThreadRow";
import type { ThreadCard } from "./types";
import { watchDeskThreads } from "./watch";

export { pickApproachSuggestion } from "../lib/approachCard";

export function pickApproachScout(threads: ThreadCard[]): ThreadCard | null {
  return preferRootTargets(threads)[0] ?? null;
}

export function ApproachLoadingCard() {
  return (
    <div className="mission-card" aria-busy="true" role="status">
      <p className="mission-card-verb">Approach</p>
      <p className="mission-card-why">
        <span className="mission-skel mission-skel-summary" />
      </p>
      <article className="thread-row mission-skel-card" aria-hidden="true">
        <div className="row-head next-action-head">
          <div className="row-lead bait">
            <span className="mission-skel mission-skel-lead" />
          </div>
          <div className="row-main">
            <span className="mission-skel mission-skel-summary" />
            <span className="mission-skel mission-skel-meta" />
          </div>
          <div className="caret">+</div>
        </div>
      </article>
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
  if (phase === "organic_reply") return "Suggested reply";
  if (phase === "fork") return "Fork";
  if (phase === "original") return "Original";
  if (phase === "silent_refuel") return "For You";
  if (phase === "done_for_now") return "Scouting";
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
  forYouProgress?: ForYouProgress | null;
  forYouExtra?: ForYouExtraUsage | null;
  coaching?: CoachingState | null;
  requestExtra?: () => void | Promise<void>;
  scout: ThreadCard | null;
  suggestion: ForYouSuggestion | null;
  searching?: boolean;
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
  onForYouNext?: () => void;
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
        <div className="threads">
          <ForYouFeedRow
            status={props.forYouStatus}
            onNext={props.onForYouNext}
          />
        </div>
        <ReplyPaceBar
          clock={props.clock}
          remainingMs={props.remainingMs}
          onBypass={props.onBypass}
        />
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
    return (
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
        {action === "wait" ? extra : null}
      </div>
    );
  }

  if (props.phase === "scout_reply" && props.scout) {
    const thread = props.scout;
    const why = phaseWhy(props.phase, props.coaching);
    return (
      <div className="mission-card">
        <p className="mission-card-verb">{phaseVerb(props.phase)}</p>
        <p className="mission-card-why">{why}</p>
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
        <p className="mission-card-why">{why}</p>
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

  const why =
    props.phase === "done_for_now"
      ? approachCollectingCopy({ searching: props.searching })
      : phaseWhy(props.phase, props.coaching);
  return (
    <div className="mission-card">
      <p className="mission-card-verb">{phaseVerb(props.phase)}</p>
      <p className="mission-card-why">{why}</p>
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
