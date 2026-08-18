import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./lib/apiBase";
import {
  SUGGEST_PHASES,
  VERIFY_PHASES,
  localEditHint,
  phaseIndexAt,
  suggestsLeftLabel,
  type SuggestUsage,
  type VoicePhase,
} from "./lib/voice";

type PaneStage = "idle" | "composing" | "editing" | "verifying" | "ready";

function PhaseLine({
  phases,
  startedAt,
}: {
  phases: readonly VoicePhase[];
  startedAt: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 400);
    return () => window.clearInterval(id);
  }, []);
  const idx = phaseIndexAt(phases, now - startedAt);
  return (
    <div className="suggest-loading" role="status" aria-live="polite">
      <span className="voice-loader-pulse" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="voice-loader-line">{phases[idx]!.label}</span>
    </div>
  );
}

export function SuggestPane({
  threadId,
  author,
  text,
  opAuthor,
  opText,
  agenda,
  usage,
  onUsage,
  onOpenIntent,
}: {
  threadId: string;
  author: string;
  text: string;
  opAuthor?: string;
  opText?: string;
  agenda?: string;
  usage: SuggestUsage;
  onUsage: (usage: SuggestUsage) => void;
  /** Arm the existing mark/detect flow before x.com opens. */
  onOpenIntent?: () => void;
}) {
  const [stage, setStage] = useState<PaneStage>("idle");
  const [draft, setDraft] = useState("");
  const [edited, setEdited] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [noteKind, setNoteKind] = useState<"info" | "ok" | "fail">("info");
  const [intentUrl, setIntentUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attemptRef = useRef(0);

  const hint = stage === "editing" ? localEditHint(draft, edited) : null;

  function onClose() {
    attemptRef.current++;
    setStage("idle");
    setDraft("");
    setEdited("");
    setNote(null);
    setNoteKind("info");
    setIntentUrl(null);
    setCopied(false);
  }

  async function onSuggest() {
    const attempt = ++attemptRef.current;
    setStage("composing");
    setStartedAt(Date.now());
    setNote(null);
    try {
      const res = await apiFetch("/api/voice/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, author, text, opAuthor, opText, agenda }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        draft?: string;
        message?: string;
        error?: string;
        suggests?: SuggestUsage;
        used?: number;
        limit?: number;
        planKey?: string;
      };
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
      if (attemptRef.current !== attempt) return;
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
      setEdited(data.draft);
      if (data.suggests) onUsage(data.suggests);
      setStage("editing");
      setNoteKind("info");
      setNote(null);
      window.setTimeout(() => textareaRef.current?.focus(), 50);
    } catch {
      if (attemptRef.current !== attempt) return;
      setStage("idle");
      setNoteKind("fail");
      setNote("Couldn't reach the desk — try again.");
    }
  }

  async function onVerify() {
    const attempt = ++attemptRef.current;
    setStage("verifying");
    setStartedAt(Date.now());
    setNote(null);
    try {
      const res = await apiFetch("/api/voice/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, edited, inReplyToId: threadId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        pass?: boolean;
        reason?: string;
        intentUrl?: string;
        message?: string;
      };
      if (attemptRef.current !== attempt) return;
      if (!res.ok || !data.ok) {
        setStage("editing");
        setNoteKind("fail");
        setNote(data.message ?? "Verify hiccuped — try again.");
        return;
      }
      if (data.pass && data.intentUrl) {
        setIntentUrl(data.intentUrl);
        setStage("ready");
        setNoteKind("ok");
        setNote(data.reason ?? "That reads like you. Ready to post.");
      } else {
        setStage("editing");
        setNoteKind("fail");
        setNote(data.reason ?? "Not quite yours yet — change something real.");
        window.setTimeout(() => textareaRef.current?.focus(), 50);
      }
    } catch {
      if (attemptRef.current !== attempt) return;
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
    }
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(edited.trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setNoteKind("fail");
      setNote("Clipboard blocked — select and copy by hand.");
    }
  }

  if (stage === "idle") {
    return (
      <div className="suggest-pane suggest-idle">
        <button
          type="button"
          className="ghost suggest-trigger"
          disabled={!usage.canSuggest}
          onClick={() => void onSuggest()}
        >
          Suggest reply
        </button>
        <span className="suggest-quota">{suggestsLeftLabel(usage)}</span>
        {note ? <p className="suggest-note is-fail">{note}</p> : null}
      </div>
    );
  }

  if (stage === "composing") {
    return (
      <div className="suggest-pane">
        <div className="suggest-pane-head">
          <PhaseLine phases={SUGGEST_PHASES} startedAt={startedAt} />
          <button type="button" className="ghost suggest-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const verified = stage === "ready";

  return (
    <div className="suggest-pane">
      <div className="suggest-pane-head">
        <p className="suggest-banner" role="note">
          AI-generated. Edit before posting. It won&apos;t unlock until you make
          it yours.
        </p>
        <button
          type="button"
          className="ghost suggest-close"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <textarea
        ref={textareaRef}
        className="suggest-textarea"
        value={edited}
        rows={4}
        maxLength={560}
        disabled={stage === "verifying"}
        aria-label="Your reply — edit the draft"
        onChange={(e) => onEdit(e.target.value)}
      />
      <div className="suggest-foot">
        <span
          className={
            edited.trim().length > 280 ? "suggest-count over" : "suggest-count"
          }
        >
          {edited.trim().length} / 280
        </span>
        {stage === "verifying" ? (
          <PhaseLine phases={VERIFY_PHASES} startedAt={startedAt} />
        ) : (
          <div className="suggest-actions">
            {!verified ? (
              <button
                type="button"
                className="primary suggest-verify"
                disabled={Boolean(hint)}
                title={hint ?? undefined}
                onClick={() => void onVerify()}
              >
                Check my edit
              </button>
            ) : null}
            <button
              type="button"
              className={verified ? "primary" : "ghost"}
              disabled={!verified}
              onClick={() => void onCopy()}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            {verified && intentUrl ? (
              <a
                className="primary suggest-open"
                href={intentUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => onOpenIntent?.()}
              >
                Open on X
              </a>
            ) : (
              <button type="button" className="ghost" disabled>
                Open on X
              </button>
            )}
          </div>
        )}
      </div>
      {hint && !note ? <p className="suggest-note is-hint">{hint}</p> : null}
      {note ? (
        <p
          className={
            noteKind === "ok"
              ? "suggest-note is-ok"
              : noteKind === "fail"
                ? "suggest-note is-fail"
                : "suggest-note"
          }
          role="status"
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}
