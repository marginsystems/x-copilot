/**
 * One presenter for the Approach card. Verb, why, buttons, badge, and detector
 * ownership derive from the locked task; searching updates the Collecting row.
 */
import type { CoachingState, OwnActivity } from "../lib/coaching";
import type { ApproachGate, ApproachLock, DeskPhase } from "../lib/deskPhase";
import {
  FYP_ACTION_COPY,
  FYP_DETECTED_COPY,
  FYP_DETECTING_COPY,
  FYP_WAIT_COPY,
  type ForYouSuggestion,
} from "../lib/forYou";
import { approachCollectingCopy, phaseWhy } from "../lib/phaseWhy";
import type { ThreadCard } from "./types";

/** Reading, an original, or a quote count during the reply minute. */
export const FYP_HOLD_ACTION_COPY =
  "One reply a minute. Read For You; an original or quote counts now. The next reply waits for the clock. Likes do not count.";
export const GATE_LINK_X_WHY = "Link X so the desk can see what you post.";
export const GATE_SETTINGS_WHY =
  "Set an agenda in Settings so Scout knows what to look for.";

/** The For You wait as the presenter needs it: armed, and whether it hit. */
export type ForYouTaskView = { detected: boolean };

export type ApproachCardInput = {
  phase: DeskPhase;
  surface: ApproachLock["surface"];
  /** Retained presentation card for the lock. May be a consumed card. */
  scout: ThreadCard | null;
  /** The locked Scout target has a recorded reply. */
  scoutDetected: boolean;
  suggestion: ForYouSuggestion | null;
  /** Null when no wait is armed for this task. */
  forYou: ForYouTaskView | null;
  /** Remaining reply minute. */
  remainingMs: number;
  searching?: boolean;
  coaching?: CoachingState | null;
};

export type ApproachPresentation = {
  kind: "gate" | "for_you" | "scout" | "scout_missing" | "suggested" | "blank";
  verb: string;
  why: string;
  badge: 0 | 1;
  gate: ApproachGate | null;
  forYou: {
    detected: boolean;
    status: string;
    actionCopy: string;
    activity: OwnActivity | null;
    /** The reply minute is running: no Next, Bypass is the exit. */
    holding: boolean;
    showNext: boolean;
  } | null;
  showPace: boolean;
  /** Which existing poll this task owns. Null once detected or when nothing to detect. */
  detector: "for_you" | "scout" | null;
};

function scoutVerb(scout: ThreadCard | null): string {
  return scout?.surface === "repost" ? "Repost" : "Reply";
}

function suggestionVerb(row: ForYouSuggestion | null): string {
  if (row?.kind === "post") return "Original";
  if (row?.kind === "quote") return "Quote";
  if (row?.kind === "repost") return "Repost";
  return "Suggested reply";
}

function forYouPresentation(input: ApproachCardInput): ApproachPresentation {
  const holding = input.remainingMs > 0;
  const detected = input.forYou?.detected === true;
  const latestActivity = input.coaching?.ownActivity ?? null;
  const activity =
    detected &&
    latestActivity &&
    ((latestActivity.kind === "reply" && input.coaching?.replyAt?.length) ||
      input.coaching?.replyAt?.[0] === latestActivity.postedAt ||
      input.coaching?.postAt?.[0] === latestActivity.postedAt)
      ? latestActivity
      : null;
  const status = !input.forYou
    ? FYP_WAIT_COPY
    : detected
      ? FYP_DETECTED_COPY
      : FYP_DETECTING_COPY;
  return {
    kind: "for_you",
    verb: holding ? "Hold" : "For You",
    why: "",
    badge: 1,
    gate: null,
    forYou: {
      detected,
      status,
      actionCopy: holding ? FYP_HOLD_ACTION_COPY : FYP_ACTION_COPY,
      activity,
      holding,
      showNext: !holding,
    },
    showPace: holding,
    detector: input.forYou && !detected ? "for_you" : null,
  };
}

export function presentApproach(input: ApproachCardInput): ApproachPresentation {
  const showPace = input.remainingMs > 0;
  const blank: ApproachPresentation = {
    kind: "blank",
    verb: "",
    why: "",
    badge: 0,
    gate: null,
    forYou: null,
    showPace,
    detector: null,
  };
  if (input.phase === "needs_onboarding") return blank;
  if (input.phase === "silent_refuel") {
    if (input.surface === "link_x" || input.surface === "settings") {
      return {
        ...blank,
        kind: "gate",
        gate: input.surface,
        verb: input.surface === "link_x" ? "Link X" : "Set agenda",
        why: input.surface === "link_x" ? GATE_LINK_X_WHY : GATE_SETTINGS_WHY,
      };
    }
    return forYouPresentation(input);
  }
  if (input.phase === "hold") return forYouPresentation(input);
  if (input.phase === "scout_reply" || input.phase === "done_for_now") {
    if (input.scout) {
      return {
        ...blank,
        kind: "scout",
        verb: scoutVerb(input.scout),
        why: phaseWhy("scout_reply", input.coaching, null, {
          detected: input.scoutDetected,
        }),
        badge: 1,
        detector: input.scoutDetected ? null : "scout",
      };
    }
    return {
      ...blank,
      kind: "scout_missing",
      verb: "Collecting",
      why: approachCollectingCopy({ searching: input.searching }),
    };
  }
  return {
    ...blank,
    kind: "suggested",
    verb: suggestionVerb(input.suggestion),
    why: phaseWhy("organic_reply", input.coaching, input.suggestion),
    badge: input.suggestion ? 1 : 0,
  };
}
