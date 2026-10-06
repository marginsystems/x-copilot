import type { ApproachCardAction, ApproachNextRequest } from "../../../shared/src/approachNext";
import { FYP_WAIT_COPY, X_FOR_YOU_URL, X_INSPIRATION_URL } from "../../../shared/src/forYou";
import {
  formatReplyPaceClock,
  replyPaceRemainingMs,
  replyPaceTip,
  seedReplyPaceUntil,
} from "../../../shared/src/replyPace";
import {
  lockMovedAfterNext,
  type DeskApproachState,
  type ScoutApproachLockCard,
  type ScoutApproachNext,
} from "../../../shared/src/scoutApproachLock";
import { cardKey, COLLECTING_CARD_KEY } from "./detection";

export type PanelCard = {
  kind: "scout" | "for_you" | "collecting";
  verb: string;
  title: string;
  detail: string;
  openUrl: string;
  openLabel: string;
  secondary: { url: string; label: string } | null;
};

export type PanelPace = { remainingMs: number; clock: string; tip: string };

export function scoutOpenUrl(card: ScoutApproachLockCard): string {
  if (card.url && /^https:\/\/(?:www\.)?x\.com\//.test(card.url)) return card.url;
  return `https://x.com/i/status/${encodeURIComponent(card.id)}`;
}

export function panelCard(lock: ScoutApproachLockCard | null): PanelCard {
  if (lock) {
    return {
      kind: "scout",
      verb: "Reply",
      title: lock.author ?? "Scout pick",
      detail: lock.text ?? "Open the post on X and read it before you reply.",
      openUrl: scoutOpenUrl(lock),
      openLabel: "Open post on X",
      secondary: null,
    };
  }
  return {
    kind: "for_you",
    verb: "For You",
    title: "Your For You feed",
    detail: FYP_WAIT_COPY,
    openUrl: X_FOR_YOU_URL,
    openLabel: "Open For You",
    secondary: { url: X_INSPIRATION_URL, label: "Open Inspiration" },
  };
}

export function panelPace(replyAt: readonly string[] | undefined, nowMs: number): PanelPace | null {
  const until = seedReplyPaceUntil({
    storedUntil: null,
    cleared: false,
    replyAtIso: replyAt?.[0] ?? null,
    nowMs,
  });
  const remainingMs = replyPaceRemainingMs(until, nowMs);
  if (remainingMs <= 0) return null;
  const clock = formatReplyPaceClock(remainingMs);
  return { remainingMs, clock, tip: replyPaceTip(clock) };
}

export function nextFromCardId(lock: ScoutApproachLockCard | null): ApproachNextRequest {
  return lock ? { fromCardId: lock.id } : { forYou: true };
}

export type PendingNext = {
  token: string;
  request: ApproachNextRequest;
  shown: ScoutApproachLockCard | null;
};

export function shownAfterRefresh(
  pending: PendingNext | null,
  token: string,
  serverLock: ScoutApproachLockCard | null,
): ScoutApproachLockCard | null {
  if (!pending || pending.token !== token) return serverLock;
  return lockMovedAfterNext(pending.request, serverLock) ? serverLock : pending.shown;
}

export const COLLECTING_CARD: PanelCard = {
  kind: "collecting",
  verb: "Collecting",
  title: "Scout is collecting posts",
  detail: "Your next card shows here as soon as Scout has one. Keep your desk dashboard open.",
  openUrl: X_FOR_YOU_URL,
  openLabel: "Open For You",
  secondary: null,
};

export type PanelView = {
  lock: ScoutApproachLockCard | null;
  collecting: boolean;
  key: string;
  card: PanelCard;
};

export function panelView(
  shown: ScoutApproachLockCard | null,
  deskState: DeskApproachState | null | undefined,
): PanelView {
  const collecting = shown === null && deskState?.view === "collecting";
  return {
    lock: shown,
    collecting,
    key: collecting ? COLLECTING_CARD_KEY : cardKey(shown),
    card: collecting ? COLLECTING_CARD : panelCard(shown),
  };
}

export function panelDetected(opts: {
  view: PanelView;
  deskState: DeskApproachState | null | undefined;
  deskCardId: string | null;
  seenHere: boolean;
}): boolean {
  if (opts.view.collecting) return false;
  const desk = opts.deskState;
  if (opts.view.lock === null) return desk?.view === "for_you" ? desk.detected : opts.seenHere;
  const deskOnCard = desk?.view === "scout" || desk?.view === "suggestion";
  return opts.seenHere || (deskOnCard && desk.detected && opts.deskCardId === opts.view.lock.id);
}

export function panelCanAskNext(
  view: PanelView,
  detected: boolean,
  deskState: DeskApproachState | null | undefined,
  deskCardId: string | null,
): boolean {
  if (view.collecting) return false;
  return (
    view.lock === null ||
    detected ||
    (deskState?.view === "scout" && deskCardId === view.lock.id)
  );
}

export type PanelCardTarget =
  | { kind: "scout"; card: ScoutApproachLockCard }
  | { kind: "suggestion"; card: ScoutApproachLockCard; suggestionId: string };

export function panelCardTarget(opts: {
  view: PanelView;
  detected: boolean;
  deskState: DeskApproachState | null | undefined;
  deskCardId: string | null;
  suggestionId: string | null;
}): PanelCardTarget | null {
  const card = opts.view.lock;
  if (opts.view.collecting || !card || opts.detected || opts.deskCardId !== card.id) return null;
  if (opts.deskState?.view === "scout") return { kind: "scout", card };
  if (opts.deskState?.view === "suggestion" && opts.suggestionId) {
    return { kind: "suggestion", card, suggestionId: opts.suggestionId };
  }
  return null;
}

export function cardActionRequest(target: PanelCardTarget, action: ApproachCardAction): ApproachNextRequest {
  return {
    fromCardId: target.kind === "suggestion" ? target.suggestionId : target.card.id,
    action,
    kind: target.kind,
  };
}

export function panelCardActionNotice(target: PanelCardTarget, action: ApproachCardAction): string {
  if (target.kind === "suggestion") return "Could not update For You. Try again.";
  return action === "skip" ? "Could not skip. Try again." : "Could not dismiss. Try again.";
}

export function dismissConfirmCopy(card: ScoutApproachLockCard): string {
  const who = card.author ?? "this post";
  return `Dismiss ${who} from Approach. Optional reason is saved to local knowledge memory.`;
}

export function preloadedNextCard(
  request: ApproachNextRequest,
  nextUp: ScoutApproachNext | null | undefined,
): ScoutApproachNext | null {
  if (!nextUp || !lockMovedAfterNext(request, nextUp.card)) return null;
  return nextUp;
}

export type NextOutcome = "no_desk" | "not_moved" | "no_card";

export function panelNextNotice(outcome: NextOutcome): string {
  if (outcome === "no_desk") {
    return "No next card could be picked yet. Open your desk dashboard in a tab, then press Next again.";
  }
  if (outcome === "no_card") {
    return "No new card yet. Keep your desk dashboard open; the next card shows here when it is ready.";
  }
  return "Your desk is open on another page. It moves to the next card as soon as its dashboard is showing.";
}
