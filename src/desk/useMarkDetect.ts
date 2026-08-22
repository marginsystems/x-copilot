import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/apiBase";
import {
  MARK_DETECT_TIMEOUT_MS,
  markDetectCheckingNote,
  markDetectMissNote,
  markDetectTimeoutNote,
  markDetectWaitingNote,
  nextMarkDetectWaitMs,
  shouldContinueMarkDetectPoll,
  waitWithCountdown,
} from "../lib/markDetectPoll";
import { parseStatusIdFromUrl } from "./threadHelpers";
import type { ThreadCard } from "./types";

export type AppToast = {
  id: number;
  text: string;
  kind: "ok" | "warn";
};

type UseMarkDetectDeps = {
  postInteracted: (
    thread: ThreadCard,
    replyUrl: string,
    reply: string,
    signal?: AbortSignal,
  ) => Promise<boolean>;
};

export function useMarkDetect({ postInteracted }: UseMarkDetectDeps) {
  const [markThread, setMarkThread] = useState<ThreadCard | null>(null);
  const [markDetectNote, setMarkDetectNote] = useState("");
  const [toast, setToast] = useState<AppToast | null>(null);
  const markDetectGenRef = useRef(0);
  const markDetectAbortRef = useRef<AbortController | null>(null);

  function showToast(text: string, kind: "ok" | "warn" = "ok") {
    setToast({ id: Date.now(), text, kind });
  }

  function closeMarkModal() {
    markDetectGenRef.current += 1;
    markDetectAbortRef.current?.abort();
    markDetectAbortRef.current = null;
    setMarkThread(null);
    setMarkDetectNote("");
  }

  function finishMarkDetect(
    gen: number,
    text: string,
    kind: "ok" | "warn" = "warn",
  ) {
    if (markDetectGenRef.current !== gen) return;
    closeMarkModal();
    showToast(text, kind);
  }

  async function runMarkDetect(thread: ThreadCard, gen: number) {
    markDetectAbortRef.current?.abort();
    const ac = new AbortController();
    markDetectAbortRef.current = ac;
    const startedAt = Date.now();
    let attempt = 0;
    let lastReason: string | undefined;

    while (markDetectGenRef.current === gen && !ac.signal.aborted) {
      if (Date.now() - startedAt >= MARK_DETECT_TIMEOUT_MS) {
        finishMarkDetect(gen, markDetectTimeoutNote());
        return;
      }
      attempt += 1;
      setMarkDetectNote(markDetectCheckingNote(attempt));

      let found = false;
      let replyUrl = "";
      let replyText = "";
      let reason: string | undefined;

      try {
        const res = await apiFetch("/api/interacted/detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: thread.id,
            conversationId: thread.conversationId,
            once: true,
          }),
          signal: ac.signal,
        });
        if (markDetectGenRef.current !== gen) return;
        const data = (await res.json().catch(() => ({}))) as {
          found?: boolean;
          reason?: string;
          reply?: { replyUrl?: string; replyText?: string };
          message?: string;
          error?: string;
        };
        if (markDetectGenRef.current !== gen) return;

        if (!res.ok) {
          if (res.status === 401 || res.status === 503) {
            finishMarkDetect(
              gen,
              "Could not look up your reply — sign in again and mark.",
            );
            return;
          }
          if (res.status === 402 || data.error === "credits_exhausted") {
            finishMarkDetect(
              gen,
              typeof data.message === "string" && data.message
                ? data.message
                : "This month's credits are used. Upgrade on Usage & Billing, or wait until the next UTC month.",
            );
            return;
          }
          reason = "search_failed";
          lastReason = reason;
        } else if (
          data.found &&
          typeof data.reply?.replyUrl === "string" &&
          parseStatusIdFromUrl(data.reply.replyUrl)
        ) {
          found = true;
          replyUrl = data.reply.replyUrl;
          replyText =
            typeof data.reply.replyText === "string" ? data.reply.replyText : "";
        } else {
          reason = typeof data.reason === "string" ? data.reason : "none";
          lastReason = reason;
        }
      } catch (err) {
        if (markDetectGenRef.current !== gen) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        reason = "search_failed";
        lastReason = reason;
      }

      if (found) {
        setMarkDetectNote("Found your reply — saving…");
        const ok = await postInteracted(thread, replyUrl, replyText, ac.signal);
        if (markDetectGenRef.current !== gen) return;
        finishMarkDetect(
          gen,
          ok
            ? replyText.trim()
              ? `Marked ${thread.author} interacted — memory saved`
              : `Marked ${thread.author} interacted`
            : "Could not save the mark. Try again.",
          ok ? "ok" : "warn",
        );
        return;
      }

      const elapsedMs = Date.now() - startedAt;
      if (
        !shouldContinueMarkDetectPoll({
          found: false,
          reason,
          elapsedMs,
        })
      ) {
        finishMarkDetect(
          gen,
          elapsedMs >= MARK_DETECT_TIMEOUT_MS && reason !== "ambiguous"
            ? markDetectTimeoutNote()
            : markDetectMissNote(reason ?? lastReason),
        );
        return;
      }

      const waitMs = nextMarkDetectWaitMs({ elapsedMs });
      if (waitMs <= 0) {
        finishMarkDetect(gen, markDetectTimeoutNote());
        return;
      }

      const waited = await waitWithCountdown(waitMs, {
        signal: ac.signal,
        onTick: (secondsLeft) => {
          if (markDetectGenRef.current !== gen) return;
          setMarkDetectNote(markDetectWaitingNote(secondsLeft, attempt + 1));
        },
      });
      if (waited === "aborted" || markDetectGenRef.current !== gen) return;
    }
  }

  function openMarkModal(thread: ThreadCard) {
    const gen = ++markDetectGenRef.current;
    setMarkThread(thread);
    setMarkDetectNote(`Looking for your reply to ${thread.author}…`);
    void runMarkDetect(thread, gen);
  }

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 4200);
    return () => window.clearTimeout(id);
  }, [toast]);

  return {
    markThread,
    markDetectNote,
    toast,
    openMarkModal,
    closeMarkModal,
  };
}
