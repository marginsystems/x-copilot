import { useEffect, useRef, useState } from "react";
import { useSession } from "./auth/session";
import { apiFetch } from "./lib/apiBase";
import { isRecord } from "./lib/typeGuards";
import { localEditHint, type SuggestUsage } from "./lib/voice";

type PaneStage =
  | "idle"
  | "composing"
  | "stance"
  | "editing"
  | "verifying"
  | "ready";

export type SuggestPaneProps = {
  threadId: string;
  author: string;
  text: string;
  opAuthor?: string;
  opText?: string;
  threadKind?: string;
  flags?: string[];
  agenda?: string;
  usage: SuggestUsage;
  onUsage: (usage: SuggestUsage) => void;
  /** Arm the existing mark/detect flow before x.com opens. */
  onOpenIntent?: () => void;
  /** For You originals/quotes. Scout stays on reply (no desk Post). */
  variant?: "reply" | "compose";
  composeKind?: "post" | "quote";
  suggestionId?: string;
  quoteTweetId?: string | null;
  onDeskPosted?: () => void;
};

export function parseSuggestResponse(raw: unknown) {
  const data = isRecord(raw) ? raw : {};
  const suggests = data.suggests;
  return {
    ok: data.ok,
    needed: data.needed,
    fallback: data.fallback,
    pass: data.pass,
    canPost: data.canPost,
    options: Array.isArray(data.options) && data.options.every((item: unknown) => typeof item === "string") ? data.options : undefined,
    draft: typeof data.draft === "string" ? data.draft : undefined,
    message: typeof data.message === "string" ? data.message : undefined,
    error: typeof data.error === "string" ? data.error : undefined,
    reason: typeof data.reason === "string" ? data.reason : undefined,
    intentUrl: typeof data.intentUrl === "string" ? data.intentUrl : undefined,
    used: typeof data.used === "number" ? data.used : undefined,
    limit: typeof data.limit === "number" ? data.limit : undefined,
    planKey: typeof data.planKey === "string" ? data.planKey : undefined,
    suggests: isRecord(suggests) &&
      typeof suggests.used === "number" && typeof suggests.limit === "number" &&
      typeof suggests.remaining === "number" && typeof suggests.canSuggest === "boolean" &&
      typeof suggests.planKey === "string"
      ? { used: suggests.used, limit: suggests.limit, remaining: suggests.remaining, canSuggest: suggests.canSuggest, planKey: suggests.planKey }
      : undefined,
  };
}

export function useSuggestPane({
  threadId,
  author,
  text,
  opAuthor,
  opText,
  threadKind,
  flags,
  agenda,
  usage,
  onUsage,
  variant = "reply",
  composeKind = "post",
  suggestionId,
  quoteTweetId,
  onDeskPosted,
}: SuggestPaneProps) {
  const ownerSession = useSession();
  const generation = ownerSession.capture();
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
      attemptRef.current += 1;
    };
  }, []);
  const active = () => mountedRef.current && ownerSession.isCurrent(generation);
  const current = (paneSession: number) => active() && paneSession === sessionRef.current;
  const [stage, setStage] = useState<PaneStage>("idle");
  const [draft, setDraft] = useState("");
  const [edited, setEdited] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [noteKind, setNoteKind] = useState<"info" | "ok" | "fail">("info");
  const [intentUrl, setIntentUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [draftCopied, setDraftCopied] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [stances, setStances] = useState<string[]>([]);
  const [stancesFallback, setStancesFallback] = useState(false);
  const [customStance, setCustomStance] = useState("");
  const [canPost, setCanPost] = useState(false);
  const [posting, setPosting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** Bumped on every close so an in-flight fetch can't reopen the pane. */
  const sessionRef = useRef(0);
  /** Synchronous in-flight guard so a double-click can't burn two suggest slots. */
  const suggestBusyRef = useRef(false);
  const attemptRef = useRef(0);
  const postKeyRef = useRef("");
  const compose = variant === "compose";

  const editHint = localEditHint(draft, edited);
  const hint = stage === "editing" ? editHint : null;

  function composeFields() {
    return compose
      ? {
          mode: "compose" as const,
          kind: composeKind,
          suggestionId: suggestionId ?? threadId,
        }
      : {};
  }

  function onError(err: unknown) {
    if (!active()) return;
    setNoteKind("fail");
    setNote(err instanceof Error ? err.message : String(err));
  }

  function onClose() {
    sessionRef.current += 1;
    attemptRef.current++;
    setStage("idle");
    setDraft("");
    setEdited("");
    setNote(null);
    setNoteKind("info");
    setIntentUrl(null);
    setCopied(false);
    setDraftCopied(false);
    setStances([]);
    setStancesFallback(false);
    setCustomStance("");
    setCanPost(false);
    setPosting(false);
    postKeyRef.current = "";
  }

  async function onStart() {
    if (!active() || suggestBusyRef.current) return;
    const session = sessionRef.current;
    setStage("composing");
    setStartedAt(Date.now());
    setNote(null);
    let res: Response;
    let data: ReturnType<typeof parseSuggestResponse>;
    try {
      res = await apiFetch("/api/voice/stances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          author,
          text,
          opAuthor,
          opText,
          threadKind,
          flags,
          ...composeFields(),
        }),
      });
      data = parseSuggestResponse(await res.json().catch(() => ({})));
    } catch {
      if (!current(session)) return;
      setStage("idle");
      setNoteKind("fail");
      setNote("Stance lookup hiccuped — try again.");
      return;
    }
    if (!current(session)) return;
    if (
      res.ok &&
      data.ok &&
      data.needed &&
      Array.isArray(data.options) &&
      data.options.length >= 2
    ) {
      setStances(data.options.slice(0, 3));
      setStancesFallback(Boolean(data.fallback));
      setStage("stance");
      return;
    }
    if (!res.ok || !data.ok) {
      setStage("idle");
      setNoteKind("fail");
      setNote(
        data.message ?? "Stance lookup failed — try again.",
      );
      return;
    }
    await onSuggest();
  }

  async function onSuggest(stance?: string) {
    if (!active() || suggestBusyRef.current) return;
    suggestBusyRef.current = true;
    const session = sessionRef.current;
    const attempt = ++attemptRef.current;
    setStage("composing");
    setStartedAt(Date.now());
    setNote(null);
    try {
      const res = await apiFetch("/api/voice/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          author,
          text,
          opAuthor,
          opText,
          agenda,
          stance,
          ...composeFields(),
        }),
      });
      const data = parseSuggestResponse(await res.json().catch(() => ({})));
      if (!current(session)) return;
      if (data.error === "suggest_daily_limit") {
        const used = typeof data.used === "number" ? data.used : usage.used;
        const limit =
          typeof data.limit === "number" ? data.limit : usage.limit;
        onUsage({
          used,
          limit,
          remaining: Math.max(0, limit - used),
          canSuggest: used < limit,
          planKey:
            typeof data.planKey === "string" ? data.planKey : usage.planKey,
        });
      }
      if (!current(session) || attemptRef.current !== attempt) return;
      if (!res.ok || !data.ok || !data.draft) {
        setStage("idle");
        setNoteKind("fail");
        setNote(
          data.error === "suggest_daily_limit"
            ? data.message ?? "Daily suggest cap reached — refills at 00:00 UTC."
            : data.message ?? "Couldn't draft right now — try again.",
        );
        return;
      }
      setDraft(data.draft);
      setEdited("");
      if (data.suggests) onUsage(data.suggests);
      setStage("editing");
      setNoteKind("info");
      setNote(null);
      window.setTimeout(() => {
        if (current(session) && attemptRef.current === attempt) textareaRef.current?.focus();
      }, 50);
    } catch {
      if (!current(session) || attemptRef.current !== attempt) return;
      setStage("idle");
      setNoteKind("fail");
      setNote("Couldn't reach the desk — try again.");
    } finally {
      suggestBusyRef.current = false;
    }
  }

  async function onVerify() {
    if (!active()) return;
    const session = sessionRef.current;
    const attempt = ++attemptRef.current;
    setStage("verifying");
    setStartedAt(Date.now());
    setNote(null);
    try {
      const res = await apiFetch("/api/voice/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          compose
            ? {
                draft,
                edited,
                mode: "compose",
                quoteTweetId: quoteTweetId || undefined,
              }
            : { draft, edited, inReplyToId: threadId },
        ),
      });
      const data = parseSuggestResponse(await res.json().catch(() => ({})));
      if (!current(session) || attemptRef.current !== attempt) return;
      if (!res.ok || !data.ok) {
        setStage("editing");
        setNoteKind("fail");
        setNote(data.message ?? "Verify hiccuped — try again.");
        return;
      }
      if (data.pass && data.intentUrl) {
        setIntentUrl(data.intentUrl);
        setCanPost(Boolean(data.canPost) && compose);
        postKeyRef.current = compose
          ? `fy-${suggestionId ?? threadId}-${crypto.randomUUID()}`
          : "";
        setStage("ready");
        setNoteKind("ok");
        setNote(
          data.reason ??
            (compose
              ? "That reads like you. Post from the desk or open on X."
              : "That reads like you. Open on X when you're ready."),
        );
      } else {
        setStage("editing");
        setNoteKind("fail");
        setNote(data.reason ?? "Not quite yours yet — change something real.");
        window.setTimeout(() => {
          if (current(session) && attemptRef.current === attempt) textareaRef.current?.focus();
        }, 50);
      }
    } catch {
      if (!current(session) || attemptRef.current !== attempt) return;
      setStage("editing");
      setNoteKind("fail");
      setNote("Couldn't reach the desk — try again.");
    }
  }

  function onEdit(next: string) {
    setEdited(next);
    setCopied(false);
    setNote(null);
    // Any change after a pass re-locks Copy + Open on X.
    if (stage === "ready") {
      setStage("editing");
      setIntentUrl(null);
      setCanPost(false);
      postKeyRef.current = "";
    }
  }

  async function onDeskPost() {
    if (!active() || !compose || !canPost || posting || !suggestionId) return;
    const session = sessionRef.current;
    const attempt = ++attemptRef.current;
    setPosting(true);
    setNote(null);
    try {
      const res = await apiFetch("/api/voice/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "compose",
          kind: composeKind,
          suggestionId,
          draft,
          edited,
          requestKey: postKeyRef.current || undefined,
        }),
      });
      const data = parseSuggestResponse(await res.json().catch(() => ({})));
      if (!current(session) || attemptRef.current !== attempt) return;
      if (!res.ok || !data.ok) {
        setNoteKind("fail");
        setNote(
          data.error === "x_write_required"
            ? "Re-link X with Read and write to post from the desk."
            : data.message ?? "Could not post — try Open on X.",
        );
        return;
      }
      setNoteKind("ok");
      setNote("Posted from the desk.");
      onDeskPosted?.();
    } catch {
      if (!current(session) || attemptRef.current !== attempt) return;
      setNoteKind("fail");
      setNote("Couldn't reach the desk — try Open on X.");
    } finally {
      if (current(session) && attemptRef.current === attempt) setPosting(false);
    }
  }

  async function onCopyDraft() {
    if (!active()) return;
    const session = sessionRef.current;
    try {
      await navigator.clipboard.writeText(draft);
      if (!current(session)) return;
      setDraftCopied(true);
      window.setTimeout(() => { if (current(session)) setDraftCopied(false); }, 2000);
    } catch {
      if (!current(session)) return;
      setNoteKind("fail");
      setNote("Clipboard blocked — select and copy by hand.");
    }
  }

  async function onCopy() {
    if (!active()) return;
    const session = sessionRef.current;
    try {
      await navigator.clipboard.writeText(edited.trim());
      if (!current(session)) return;
      setCopied(true);
      window.setTimeout(() => { if (current(session)) setCopied(false); }, 2000);
    } catch {
      if (!current(session)) return;
      setNoteKind("fail");
      setNote("Clipboard blocked — select and copy by hand.");
    }
  }

  return {
    stage,
    draft,
    edited,
    note,
    noteKind,
    intentUrl,
    copied,
    draftCopied,
    startedAt,
    stances,
    stancesFallback,
    customStance,
    setCustomStance,
    canPost,
    posting,
    textareaRef,
    compose,
    editHint,
    hint,
    onError,
    onClose,
    onStart,
    onSuggest,
    onVerify,
    onEdit,
    onDeskPost,
    onCopy,
    onCopyDraft,
  };
}
