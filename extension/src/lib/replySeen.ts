import type { ScoutApproachLockCard } from "../../../shared/src/scoutApproachLock";
import { statusIdFromPath } from "./attention";

export const REPLY_SEEN_KEY = "lastReplySeenAt";
export const REPLIED_CARD_KEY = "lastRepliedCardId";
export const REPLY_PACE_AT_KEY = "lastReplyPaceAt";

export function parseReplyPaceAt(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}

export type InteractedBody = {
  threadId: string;
  author: string;
  replyUrl: string;
  url?: string;
  text?: string;
  conversationId?: string;
  inReplyToId?: string;
};

export type ReplyReport =
  | { kind: "scout"; body: InteractedBody }
  | { kind: "catch_up" };

export function postedStatusUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, "https://x.com");
    if (url.hostname !== "x.com" && url.hostname !== "www.x.com") return null;
    const id = statusIdFromPath(url.pathname);
    if (!id) return null;
    const handle = url.pathname.split("/")[1];
    return `https://x.com/${handle}/status/${id}`;
  } catch {
    return null;
  }
}

export type SeenPostBody = { postId: string; url: string; pageStatusId?: string };

export function seenPostBody(replyUrl: string, pageStatusId: string | null): SeenPostBody | null {
  const url = postedStatusUrl(replyUrl);
  const postId = url ? statusIdFromPath(new URL(url).pathname) : null;
  if (!url || !postId) return null;
  return pageStatusId && pageStatusId !== postId ? { postId, url, pageStatusId } : { postId, url };
}

export function replyReport(
  lock: ScoutApproachLockCard | null,
  pageStatusId: string | null,
  replyUrl: string,
): ReplyReport {
  const onLockedPost =
    lock !== null &&
    pageStatusId !== null &&
    [lock.id, lock.conversationId, lock.inReplyToId].includes(pageStatusId);
  if (!lock || !lock.author || !onLockedPost) return { kind: "catch_up" };
  return {
    kind: "scout",
    body: {
      threadId: lock.id,
      author: lock.author,
      replyUrl,
      ...(lock.url ? { url: lock.url } : {}),
      ...(lock.text ? { text: lock.text } : {}),
      ...(lock.conversationId ? { conversationId: lock.conversationId } : {}),
      ...(lock.inReplyToId ? { inReplyToId: lock.inReplyToId } : {}),
    },
  };
}
