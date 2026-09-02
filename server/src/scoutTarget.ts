/**
 * Scout aims at original posts people are already looking at.
 * Leaves become the conversation root when we have OP text; otherwise they drop.
 */
import { dedupeThreads, type ThreadCard } from "./threadCard.js";

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

/** Rewrite a reply card so compose lands on the OP. */
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
    views: thread.opViews ?? thread.views,
    opAuthor: undefined,
    opText: undefined,
    opParentDerived: undefined,
    opCharCount: undefined,
    opLongform: undefined,
    opViews: undefined,
  };
}

export function audienceViews(thread: Pick<ThreadCard, "views" | "opViews">): number {
  const n = thread.opViews ?? thread.views;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

export function sortByAudience<T extends Pick<ThreadCard, "views" | "opViews">>(
  threads: readonly T[],
): T[] {
  return [...threads].sort((a, b) => audienceViews(b) - audienceViews(a));
}

/** Roots only, highest views first. Unretargetable leaves are dropped. */
export function preferRootTargets(threads: readonly ThreadCard[]): ThreadCard[] {
  const out: ThreadCard[] = [];
  for (const thread of threads) {
    const next = retargetLeafToRoot(thread);
    if (next) out.push(next);
  }
  return sortByAudience(dedupeThreads(out));
}
