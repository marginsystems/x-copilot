import { apiFetch } from "../lib/apiBase";
import type { ThreadCard } from "./types";

export function watchPayloadsForThread(thread: ThreadCard): Array<{
  threadId: string;
  author?: string;
  url?: string;
  text?: string;
  conversationId?: string;
}> {
  const items = [
    {
      threadId: thread.id,
      author: thread.author,
      url: thread.url,
      text: thread.text,
      conversationId: thread.conversationId,
    },
  ];
  if (
    thread.conversationId &&
    thread.conversationId !== thread.id &&
    thread.opAuthor
  ) {
    items.push({
      threadId: thread.conversationId,
      author: thread.opAuthor,
      url: `https://x.com/${thread.opAuthor.replace(/^@/, "")}/status/${thread.conversationId}`,
      text: thread.opText ?? thread.text,
      conversationId: thread.conversationId,
    });
  }
  return items;
}

export function watchDeskThreads(list: ThreadCard[]): void {
  const threads = list.flatMap(watchPayloadsForThread).filter((t) => t.threadId);
  if (!threads.length) return;
  void apiFetch("/api/watch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threads }),
  }).catch(() => {});
}

export function ensureActivitySubscribe(): void {
  void apiFetch("/api/activity/subscribe", { method: "POST" }).catch(() => {});
}
