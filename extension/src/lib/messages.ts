import { isRecord } from "../../../shared/src/typeGuards";

export const STORE_PAIRING = "x-copilot:store-pairing";

export type StorePairingMessage = { type: typeof STORE_PAIRING; pair: unknown };

export function parseStorePairingMessage(raw: unknown): StorePairingMessage | null {
  return isRecord(raw) && raw.type === STORE_PAIRING ? { type: STORE_PAIRING, pair: raw.pair } : null;
}

export const REPLY_SEEN = "x-copilot:reply-seen";

export type ReplySeenMessage = { type: typeof REPLY_SEEN; replyUrl: string; pageStatusId: string | null };

export function parseReplySeenMessage(raw: unknown): ReplySeenMessage | null {
  if (!isRecord(raw) || raw.type !== REPLY_SEEN || typeof raw.replyUrl !== "string") return null;
  const pageStatusId = typeof raw.pageStatusId === "string" ? raw.pageStatusId : null;
  return { type: REPLY_SEEN, replyUrl: raw.replyUrl, pageStatusId };
}
