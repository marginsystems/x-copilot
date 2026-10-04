import type { ApproachNextRequest } from "../../../shared/src/approachNext";
import { FYP_WAIT_COPY, X_FOR_YOU_URL, X_INSPIRATION_URL } from "../../../shared/src/forYou";
import {
  formatReplyPaceClock,
  replyPaceRemainingMs,
  replyPaceTip,
  seedReplyPaceUntil,
} from "../../../shared/src/replyPace";
import {
  lockMovedAfterNext,
  type ScoutApproachLockCard,
  type ScoutApproachNext,
} from "../../../shared/src/scoutApproachLock";

export type PanelCard = {
  kind: "scout" | "for_you";
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

export function panelCanAskNext(lock: ScoutApproachLockCard | null, repliedCardId: string | null): boolean {
  if (lock === null) return true;
  return repliedCardId !== null && lock.id === repliedCardId;
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
    return "Open your desk dashboard in a tab, then press Next again. The desk picks the next card.";
  }
  if (outcome === "no_card") {
    return "No new card yet. Keep your desk dashboard open; the next card shows here when it is ready.";
  }
  return "Your desk is open on another page. It moves to the next card as soon as its dashboard is showing.";
}
