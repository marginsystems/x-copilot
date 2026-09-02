/**
 * Approach compose lands on the conversation root.
 * Leftover last-scout leaves retarget when we have OP text; otherwise they drop.
 */
import type { ThreadCard } from "../desk/types.ts";
import { sortThreadsByAudience } from "./threadSort.ts";

export function isLeafReply(
  thread: Pick<ThreadCard, "isReply" | "inReplyToId" | "id" | "conversationId">,
): boolean {
  if (thread.isReply === true || Boolean(thread.inReplyToId)) return true;
  const root = thread.conversationId?.trim();
  return Boolean(root && thread.id && root !== thread.id);
}

function handleFromAuthor(author: string): string {
  return author.trim().replace(/^@+/, "");
}

export function retargetLeafToRoot(thread: ThreadCard): ThreadCard | null {
  if (!isLeafReply(thread)) return thread;
  const rootId = thread.conversationId?.trim() || thread.inReplyToId?.trim();
  const author = thread.opAuthor?.trim();
  const text = thread.opText?.trim();
  if (!rootId || !author || !text) return null;
  const handle = handleFromAuthor(author);
  if (!handle) return null;
  return {
    ...thread,
    id: rootId,
    author: author.startsWith("@") ? author : `@${author}`,
    text,
    url: `https://x.com/${handle}/status/${rootId}`,
    isReply: false,
    inReplyToId: undefined,
    inReplyToScreenName: undefined,
    conversationId: rootId,
    views: thread.opParentDerived
      ? thread.opViews
      : thread.opViews ?? thread.views,
    opAuthor: undefined,
    opText: undefined,
    opParentDerived: undefined,
    opViews: undefined,
  };
}

export function preferRootTargets(threads: readonly ThreadCard[]): ThreadCard[] {
  const out: ThreadCard[] = [];
  const seen = new Set<string>();
  for (const thread of threads) {
    const next = retargetLeafToRoot(thread);
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    out.push(next);
  }
  return sortThreadsByAudience(out);
}
