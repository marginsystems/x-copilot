import { useEffect, useState } from "react";
import { useSuggestPane, type SuggestPaneProps } from "./useSuggestPane";
import {
  COMPOSE_SUGGEST_PHASES,
  SUGGEST_PHASES,
  VERIFY_PHASES,
  phaseIndexAt,
  suggestNoteClassName,
  suggestNoteSlot,
  suggestsLeftLabel,
  type VoicePhase,
} from "./lib/voice";

const USAGE_LINK = "Usage & Billing";

function noteWithUsageLink(text: string) {
  const i = text.indexOf(USAGE_LINK);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <a className="usage-cta" href="/usage">
        {USAGE_LINK}
      </a>
      {text.slice(i + USAGE_LINK.length)}
    </>
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

export function SuggestPane(props: SuggestPaneProps) {
  const { usage, onOpenIntent } = props;
  const {
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
  } = useSuggestPane(props);
  const suggestPhases = compose ? COMPOSE_SUGGEST_PHASES : SUGGEST_PHASES;
  const noun = compose ? "post" : "reply";

  if (stage === "idle") {
    return (
      <div className="suggest-pane suggest-idle">
        <button
          type="button"
          className="ghost suggest-trigger"
          disabled={!usage.canSuggest}
          onClick={() => { onStart().catch(onError); }}
        >
          {compose ? "Suggest post" : "Suggest reply"}
        </button>
        <span className="suggest-quota">{suggestsLeftLabel(usage)}</span>
        {note ? (
          <p className="suggest-note is-fail">{noteWithUsageLink(note)}</p>
        ) : null}
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
              onClick={() => { onSuggest(side).catch(onError); }}
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
            if (side) onSuggest(side).catch(onError);
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
          <PhaseLine phases={suggestPhases} startedAt={startedAt} />
          <button type="button" className="ghost suggest-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const verified = stage === "ready";
  const noteSlot = suggestNoteSlot({
    note,
    noteKind,
    hint: editHint,
    verifying: stage === "verifying",
  });

  return (
    <div className="suggest-pane">
      <div className="suggest-pane-head">
        <p className="suggest-banner" role="note">
          AI draft is a reference — write your own {noun} below. It won&apos;t
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
              onClick={() => { onCopyDraft().catch(onError); }}
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
        placeholder={compose ? "Write your post" : "Write your reply"}
        aria-label={compose ? "Your post" : "Your reply"}
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
        <div
          className={
            stage === "verifying"
              ? "suggest-actions is-checking"
              : "suggest-actions"
          }
        >
          <div
            className="suggest-actions-row"
            aria-hidden={stage === "verifying"}
          >
            {!verified ? (
              <button
                type="button"
                className="primary suggest-verify"
                disabled={stage === "verifying" || Boolean(hint)}
                title={hint ?? undefined}
                onClick={() => { onVerify().catch(onError); }}
              >
                Check my edit
              </button>
            ) : null}
            {verified && compose ? (
              <button
                type="button"
                className="primary suggest-post"
                disabled={!canPost || posting}
                title={
                  canPost
                    ? undefined
                    : "Re-link X with Read and write to post from the desk."
                }
                onClick={() => { onDeskPost().catch(onError); }}
              >
                {posting ? "Posting…" : "Post"}
              </button>
            ) : null}
            <button
              type="button"
              className="ghost"
              disabled={!verified}
              onClick={() => { onCopy().catch(onError); }}
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
          {stage === "verifying" ? (
            <PhaseLine phases={VERIFY_PHASES} startedAt={startedAt} />
          ) : null}
        </div>
      </div>
      <p
        className={suggestNoteClassName(noteSlot.kind)}
        role={noteSlot.kind === "reserved" ? undefined : "status"}
      >
        {noteWithUsageLink(noteSlot.text)}
      </p>
    </div>
  );
}
