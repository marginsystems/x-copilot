import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useState } from "react";
import { apiFetch } from "../lib/apiBase";
import type {
  DismissalHistoryEntry,
  SkipHistoryEntry,
  ThreadCard,
} from "./types";

type UseSkipDismissDeps = {
  setActionBusy: (busy: boolean) => void;
  setStatus: (status: string) => void;
  setThreads: Dispatch<SetStateAction<ThreadCard[]>>;
  setExpandedId: Dispatch<SetStateAction<string | null>>;
  setSkippedHistory: Dispatch<SetStateAction<SkipHistoryEntry[]>>;
  setDismissedHistory: Dispatch<SetStateAction<DismissalHistoryEntry[]>>;
  skippedIdsRef: MutableRefObject<Set<string>>;
  dismissedIdsRef: MutableRefObject<Set<string>>;
  blockedConversationsRef: MutableRefObject<Set<string>>;
  historyStaleRef: MutableRefObject<boolean>;
};

export function useSkipDismiss({
  setActionBusy,
  setStatus,
  setThreads,
  setExpandedId,
  setSkippedHistory,
  setDismissedHistory,
  skippedIdsRef,
  dismissedIdsRef,
  blockedConversationsRef,
  historyStaleRef,
}: UseSkipDismissDeps) {
  const [dismissThread, setDismissThread] = useState<ThreadCard | null>(null);
  const [dismissReason, setDismissReason] = useState("");

  function openDismissModal(thread: ThreadCard) {
    setDismissThread(thread);
    setDismissReason("");
  }

  function closeDismissModal() {
    setDismissThread(null);
    setDismissReason("");
  }

  async function onSkip(thread: ThreadCard): Promise<boolean> {
    setActionBusy(true);
    try {
      const res = await apiFetch("/api/skipped", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          author: thread.author,
          url: thread.url,
          text: thread.text,
          summary: thread.summary,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        skip?: SkipHistoryEntry;
      };
      if (!res.ok) {
        setStatus("Could not skip. Try again.");
        return false;
      }
      const entry: SkipHistoryEntry = data.skip ?? {
        threadId: thread.id,
        author: thread.author,
        at: new Date().toISOString(),
        url: thread.url,
        summary: thread.summary,
        text: thread.text,
      };
      skippedIdsRef.current = new Set(skippedIdsRef.current).add(thread.id);
      historyStaleRef.current = true;
      setSkippedHistory((prev) => [
        entry,
        ...prev.filter((item) => item.threadId !== thread.id),
      ]);
      setThreads((prev) => prev.filter((item) => item.id !== thread.id));
      setExpandedId((id) => (id === thread.id ? null : id));
      setStatus(`Skipped ${thread.author}`);
      return true;
    } catch {
      setStatus("Could not skip. Try again.");
      return false;
    } finally {
      setActionBusy(false);
    }
  }

  async function postDismissed(
    thread: ThreadCard,
    reason: string,
  ): Promise<boolean> {
    try {
      const res = await apiFetch("/api/dismissed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          author: thread.author,
          url: thread.url,
          text: thread.text,
          summary: thread.summary,
          opAuthor: thread.opAuthor,
          opText: thread.opText,
          conversationId: thread.conversationId,
          inReplyToId: thread.inReplyToId,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        dismissal?: DismissalHistoryEntry;
      };
      if (!res.ok) {
        setStatus("Could not dismiss. Try again.");
        return false;
      }
      const conversationRoot =
        thread.conversationId?.trim() ||
        thread.inReplyToId?.trim() ||
        thread.id;
      const entry: DismissalHistoryEntry = data.dismissal ?? {
        threadId: thread.id,
        author: thread.author,
        at: new Date().toISOString(),
        url: thread.url,
        summary: thread.summary,
        text: thread.text,
        conversationId: thread.conversationId?.trim(),
        inReplyToId: thread.inReplyToId?.trim(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      };
      dismissedIdsRef.current = new Set(dismissedIdsRef.current).add(thread.id);
      historyStaleRef.current = true;
      const blocked = new Set(blockedConversationsRef.current);
      blocked.add(conversationRoot);
      if (thread.id.trim()) blocked.add(thread.id.trim());
      if (thread.inReplyToId?.trim()) blocked.add(thread.inReplyToId.trim());
      blockedConversationsRef.current = blocked;
      setDismissedHistory((prev) => [
        entry,
        ...prev.filter((item) => item.threadId !== thread.id),
      ]);
      setThreads((prev) =>
        prev.filter((item) => {
          if (item.id === thread.id || item.id === conversationRoot) return false;
          if (
            item.conversationId &&
            item.conversationId === conversationRoot
          ) {
            return false;
          }
          if (item.inReplyToId && item.inReplyToId === conversationRoot) {
            return false;
          }
          return true;
        }),
      );
      setExpandedId((id) => (id === thread.id ? null : id));
      return true;
    } catch {
      setStatus("Could not dismiss. Try again.");
      return false;
    }
  }

  async function confirmDismiss() {
    const thread = dismissThread;
    if (!thread) return;
    setActionBusy(true);
    try {
      const ok = await postDismissed(thread, dismissReason);
      if (ok) {
        closeDismissModal();
        setStatus(`Marked ${thread.author} not interested`);
      }
    } finally {
      setActionBusy(false);
    }
  }

  return {
    dismissThread,
    dismissReason,
    setDismissReason,
    openDismissModal,
    closeDismissModal,
    onSkip,
    confirmDismiss,
  };
}
