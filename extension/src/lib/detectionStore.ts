import { browser } from "wxt/browser";
import { CARD_SINCE_KEY, nextCardSince, parseCardSince, type CardSince } from "./detection";
import { REPLY_SEEN_KEY } from "./replySeen";

export async function trackCardSince(key: string, nowMs: number): Promise<CardSince> {
  const stored = await browser.storage.local.get(CARD_SINCE_KEY);
  const previous = parseCardSince(stored[CARD_SINCE_KEY]);
  const next = nextCardSince(previous, key, nowMs);
  if (next !== previous) await browser.storage.local.set({ [CARD_SINCE_KEY]: next });
  return next;
}

export async function restoreCardSince(since: CardSince | null): Promise<void> {
  if (since) await browser.storage.local.set({ [CARD_SINCE_KEY]: since });
}

export async function readReplySeenAt(): Promise<number | null> {
  const stored = await browser.storage.local.get(REPLY_SEEN_KEY);
  const value: unknown = stored[REPLY_SEEN_KEY];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
