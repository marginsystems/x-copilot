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
  | "ready"
  | "posting";

/** Mirrors server postNeedsStance: only opinionated posts need the picker. */
function postNeedsStance(threadKind?: string, flags?: string[]): boolean {
  const kind = (threadKind ?? "").trim().toLowerCase();
  if (kind === "sharp_opinion" || kind === "timely_take") return true;
  return (flags ?? []).some(
    (flag) => flag === "political" || flag === "rage_bait",
  );
}

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
  canPost = false,
  url,
  summary,
  conversationId,
  onOpenIntent,
  onPosted,
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
  canPost?: boolean;
  url?: string;
  summary?: string;
  conversationId?: string;
  /** Arm the existing mark/detect flow before x.com opens. */
  onOpenIntent?: () => void;
  onPosted?: (payload: {
    interaction?: {
      threadId: string;
      author: string;
      at: string;
      url?: string;
      summary?: string;
      text?: string;
      replyId?: string;
      replyUrl?: string;
      postedAt?: string;
      conversationId?: string;
      inReplyToId?: string;
    };
    tweet?: { id: string; url: string };
  }) => void;
}) {
  const [stage, setStage] = useState<PaneStage>("idle");
  const [draft, setDraft] = useState("");
  const [edited, setEdited] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [noteKind, setNoteKind] = useState<"info" | "ok" | "fail">("info");
  const [intentUrl, setIntentUrl] = useState<string | null>(null);
  const [deskCanPost, setDeskCanPost] = useState(canPost);
  const [copied, setCopied] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [stances, setStances] = useState<string[]>([]);
  const [stancesFallback, setStancesFallback] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** Bumped on every close so an in-flight fetch can't reopen the pane. */
  const sessionRef = useRef(0);
  /** Synchronous in-flight guard so a double-click can't burn two suggest slots. */
  const suggestBusyRef = useRef(false);
  const postBusyRef = useRef(false);
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
    setDeskCanPost(canPost);
    setCopied(false);
    setStances([]);
    setStancesFallback(false);
  }

  async function onStart() {
    if (suggestBusyRef.current) return;
    const session = sessionRef.current;
    setStage("composing");
    setStartedAt(Date.now());
    setNote(null);
    if (!postNeedsStance(threadKind, flags)) {
      await onSuggest();
      return;
    }
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
      setEdited(data.draft);
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
        canPost?: boolean;
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
        setDeskCanPost(Boolean(data.canPost ?? canPost));
        setStage("ready");
        setNoteKind("ok");
        setNote(
          data.canPost === false
            ? `${data.reason ?? "That reads like you."} Re-link X on Account to post from here.`
            : (data.reason ?? "That reads like you. Ready to post."),
        );
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
    // Any change after a pass re-locks Copy + Post.
    if (stage === "ready" || stage === "posting") {
      setStage("editing");
      setIntentUrl(null);
    }
  }

  async function onPost() {
    if (postBusyRef.current || !deskCanPost) return;
    postBusyRef.current = true;
    const attempt = ++attemptRef.current;
    setStage("posting");
    setNote(null);
    try {
      const res = await apiFetch("/api/voice/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          edited,
          inReplyToId: threadId,
          threadId,
          author,
          url,
          text,
          summary,
          conversationId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
        tweet?: { id?: string; url?: string };
        interaction?: {
          threadId: string;
          author: string;
          at: string;
          url?: string;
          summary?: string;
          text?: string;
          replyId?: string;
          replyUrl?: string;
          postedAt?: string;
          conversationId?: string;
          inReplyToId?: string;
        };
      };
      if (attemptRef.current !== attempt) return;
      if (!res.ok || !data.ok) {
        setStage("ready");
        setNoteKind("fail");
        setNote(data.message ?? "Could not post — try again or Open on X.");
        return;
      }
      const tweetId = data.tweet?.id;
      const tweetUrl = data.tweet?.url;
      onPosted?.({
        interaction: data.interaction,
        tweet:
          tweetId && tweetUrl
            ? { id: tweetId, url: tweetUrl }
            : undefined,
      });
      onClose();
    } catch {
      if (attemptRef.current !== attempt) return;
      setStage("ready");
      setNoteKind("fail");
      setNote("Couldn't reach the desk — try again.");
    } finally {
      postBusyRef.current = false;
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
              : "This post takes a side. Pick yours, then we draft in your voice."}
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
        disabled={stage === "verifying" || stage === "posting"}
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
        ) : stage === "posting" ? (
          <p className="suggest-note" role="status">
            Posting your reply…
          </p>
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
              className={verified && !deskCanPost ? "primary" : "ghost"}
              disabled={!verified}
              onClick={() => void onCopy()}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            {verified && deskCanPost ? (
              <button
                type="button"
                className="primary suggest-verify"
                onClick={() => void onPost()}
              >
                Post reply
              </button>
            ) : null}
            {verified && intentUrl ? (
              <a
                className={deskCanPost ? "ghost" : "primary suggest-open"}
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
