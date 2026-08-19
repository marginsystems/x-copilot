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

type PaneStage =
  | "idle"
  | "composing"
  | "stance"
  | "editing"
  | "verifying"
  | "ready";

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
  threadKind,
  flags,
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
  threadKind?: string;
  flags?: string[];
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
  const [draftCopied, setDraftCopied] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [stances, setStances] = useState<string[]>([]);
  const [stancesFallback, setStancesFallback] = useState(false);
  const [customStance, setCustomStance] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** Bumped on every close so an in-flight fetch can't reopen the pane. */
  const sessionRef = useRef(0);
  /** Synchronous in-flight guard so a double-click can't burn two suggest slots. */
  const suggestBusyRef = useRef(false);
  const attemptRef = useRef(0);

  const hint = stage === "editing" ? localEditHint(draft, edited) : null;

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
  }

  async function onStart() {
    if (suggestBusyRef.current) return;
    const session = sessionRef.current;
    setStage("composing");
    setStartedAt(Date.now());
    setNote(null);
    let res: Response;
    let data: {
      ok?: boolean;
      needed?: boolean;
      options?: string[];
      fallback?: boolean;
      message?: string;
    };
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
        }),
      });
      data = (await res.json().catch(() => ({}))) as typeof data;
    } catch {
      if (session !== sessionRef.current) return;
      setStage("idle");
      setNoteKind("fail");
      setNote("Stance lookup hiccuped — try again.");
      return;
    }
    if (session !== sessionRef.current) return;
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
    if (suggestBusyRef.current) return;
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
        }),
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
      if (session !== sessionRef.current) return;
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
      setEdited("");
      if (data.suggests) onUsage(data.suggests);
      setStage("editing");
      setNoteKind("info");
      setNote(null);
      window.setTimeout(() => textareaRef.current?.focus(), 50);
    } catch {
      if (session !== sessionRef.current) return;
      if (attemptRef.current !== attempt) return;
      setStage("idle");
      setNoteKind("fail");
      setNote("Couldn't reach the desk — try again.");
    } finally {
      suggestBusyRef.current = false;
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
        setNote(data.reason ?? "That reads like you. Open on X when you're ready.");
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
          onClick={() => void onStart()}
        >
          Suggest reply
        </button>
        <span className="suggest-quota">{suggestsLeftLabel(usage)}</span>
        {note ? <p className="suggest-note is-fail">{note}</p> : null}
      </div>
    );
  }

  if (stage === "stance") {
    return (
      <div className="suggest-pane">
        <div className="suggest-pane-head">
          <p className="suggest-banner" role="note">
            {stancesFallback
              ? "The voice model couldn't pin down sides on this post — here are some general angles."
              : "Pick a side, then we draft in your voice."}
          </p>
          <button type="button" className="ghost suggest-close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="suggest-stances">
          {stances.map((side) => (
            <button
              key={side}
              type="button"
              className="ghost suggest-stance"
              onClick={() => void onSuggest(side)}
            >
              {side}
            </button>
          ))}
        </div>
        <form
          className="suggest-stance-custom"
          onSubmit={(e) => {
            e.preventDefault();
            const side = customStance.trim();
            if (side) void onSuggest(side);
          }}
        >
          <input
            type="text"
            className="suggest-stance-input"
            value={customStance}
            maxLength={140}
            placeholder="Or type your own side"
            aria-label="Your own side"
            onChange={(e) => setCustomStance(e.target.value)}
          />
          <button
            type="submit"
            className="ghost"
            disabled={!customStance.trim()}
          >
            Draft this
          </button>
        </form>
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
          AI draft is a reference — write your own reply below. It won&apos;t
          unlock until you make it yours.
        </p>
        <button
          type="button"
          className="ghost suggest-close"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      {draft ? (
        <div className="suggest-reference">
          <div className="suggest-reference-head">
            <p className="suggest-reference-label">Suggested</p>
            <button
              type="button"
              className="ghost suggest-reference-copy"
              onClick={() => {
                void navigator.clipboard.writeText(draft).then(
                  () => {
                    setDraftCopied(true);
                    window.setTimeout(() => setDraftCopied(false), 2000);
                  },
                  () => {
                    setNoteKind("fail");
                    setNote("Clipboard blocked — select and copy by hand.");
                  },
                );
              }}
            >
              {draftCopied ? "Copied" : "Copy draft"}
            </button>
          </div>
          <p className="suggest-reference-text">{draft}</p>
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        className="suggest-textarea"
        value={edited}
        rows={4}
        maxLength={560}
        disabled={stage === "verifying"}
        placeholder="Write your reply"
        aria-label="Your reply"
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
              className="ghost"
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
