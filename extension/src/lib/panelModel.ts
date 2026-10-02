import { FYP_OPEN_TIP, X_FOR_YOU_URL } from "../../../shared/src/forYou";
import {
  formatReplyPaceClock,
  replyPaceRemainingMs,
  replyPaceTip,
  seedReplyPaceUntil,
} from "../../../shared/src/replyPace";
import type { ScoutApproachLockCard } from "../../../shared/src/scoutApproachLock";

export type PanelCard = {
  kind: "scout" | "for_you";
  verb: string;
  title: string;
  detail: string;
  openUrl: string;
  openLabel: string;
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
    };
  }
  return {
    kind: "for_you",
    verb: "For You",
    title: "Your For You feed",
    detail: FYP_OPEN_TIP,
    openUrl: X_FOR_YOU_URL,
    openLabel: "Open For You",
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
