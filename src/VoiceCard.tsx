import { useEffect, useState } from "react";
import { formatTimeAgo } from "./lib/timeAgo";
import {
  LEARN_PHASES,
  phaseIndexAt,
  suggestsLeftLabel,
  unlockProgress,
  voiceUnlockCopy,
  type VoiceState,
} from "./lib/voice";

/** Cycling phase line + quiet pulse for learn / refresh. */
function VoiceLoader({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 400);
    return () => window.clearInterval(id);
  }, []);
  const idx = phaseIndexAt(LEARN_PHASES, now - startedAt);
  return (
    <div className="voice-loader" role="status" aria-live="polite">
      <span className="voice-loader-pulse" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="voice-loader-line">{LEARN_PHASES[idx]!.label}</span>
      <span className="voice-loader-steps" aria-hidden="true">
        {LEARN_PHASES.map((p, i) => (
          <span
            key={p.id}
            className={
              i < idx
                ? "voice-step done"
                : i === idx
                  ? "voice-step active"
                  : "voice-step"
            }
          />
        ))}
      </span>
    </div>
  );
}

export function VoiceCardPanel({
  voice,
  busy,
  refreshing = busy,
  error,
}: {
  voice: VoiceState | null;
  busy: boolean;
  refreshing?: boolean;
  error: string | null;
  onLearn?: () => void;
}) {
  const [learnStartedAt, setLearnStartedAt] = useState<number | null>(null);
  useEffect(() => {
    if (busy && learnStartedAt === null) setLearnStartedAt(Date.now());
    if (!busy) setLearnStartedAt(null);
  }, [busy, learnStartedAt]);

  const card = voice?.card ?? null;

  return (
    <section className="voice-panel" aria-label="Your reply voice">
      <div className="voice-head">
        <div>
          <h3 className="voice-title">Your voice</h3>
          <p className="voice-sub">
            Starts from replies you&apos;ve marked on the desk, then fills gaps
            from your public X timeline via the official API. Suggest drafts
            borrow it — you always edit and post yourself.
          </p>
        </div>
        {refreshing ? (
          <p className="voice-sub">Updating from the hourly ingest…</p>
        ) : null}
      </div>

      {error ? <p className="status danger">{error}</p> : null}

      {busy ? (
        <VoiceLoader startedAt={learnStartedAt ?? Date.now()} />
      ) : !voice || voice.status === "unlinked" || voice.status === "empty" ? (
        <p className="voice-empty">{voiceUnlockCopy(voice)}</p>
      ) : voice.status === "insufficient" ? (
        <div className="voice-locked">
          <p className="voice-empty">{voiceUnlockCopy(voice)}</p>
          <UnlockMeter voice={voice} />
        </div>
      ) : card ? (
        <div className="voice-card">
          <div className="voice-row">
            <span className="voice-label">Tone</span>
            <p className="voice-value">{card.tone}</p>
          </div>
          {card.typicalLength ? (
            <div className="voice-row">
              <span className="voice-label">Length</span>
              <p className="voice-value">{card.typicalLength}</p>
            </div>
          ) : null}
          {card.habits.length > 0 ? (
            <div className="voice-row">
              <span className="voice-label">Habits</span>
              <div className="voice-chips">
                {card.habits.map((h) => (
                  <span className="voice-chip" key={h}>
                    {h}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {card.neverDo.length > 0 ? (
            <div className="voice-row">
              <span className="voice-label">Never</span>
              <div className="voice-chips">
                {card.neverDo.map((n) => (
                  <span className="voice-chip voice-chip-never" key={n}>
                    {n}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {card.examples.length > 0 ? (
            <div className="voice-row voice-row-examples">
              <span className="voice-label">In your words</span>
              <ul className="voice-examples">
                {card.examples.slice(0, 12).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="voice-foot">
            {voice.cardUpdatedAt
              ? `Updated ${formatTimeAgo(voice.cardUpdatedAt) ?? "recently"} · `
              : ""}
            {voice.conversationCount} reply conversations ·{" "}
            {suggestsLeftLabel(voice.suggests)}
          </p>
        </div>
      ) : (
        <p className="voice-empty">
          The card needs a refresh — hit Refresh to rewrite it.
        </p>
      )}
    </section>
  );
}

function UnlockMeter({ voice }: { voice: VoiceState }) {
  return (
    <>
      <div
        className="voice-meter"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={voice.unlockAt}
        aria-valuenow={Math.min(voice.conversationCount, voice.unlockAt)}
        aria-label="Reply conversations toward unlock"
      >
        <span
          className="voice-meter-fill"
          style={{ width: `${unlockProgress(voice) * 100}%` }}
        />
      </div>
      <p className="voice-meter-label">
        {Math.min(voice.conversationCount, voice.unlockAt)} / {voice.unlockAt}{" "}
        conversations
      </p>
    </>
  );
}

/** Compact desk banner — always explains how Suggest unlocks. */
export function VoiceUnlockBanner({
  voice,
  onOpenSettings,
}: {
  voice: VoiceState | null;
  busy?: boolean;
  onLearn?: () => void;
  onOpenSettings: () => void;
}) {
  if (voice?.status === "ready" && voice.unlocked) return null;
  return (
    <aside className="voice-desk-banner" aria-label="How to unlock Suggest">
      <div className="voice-desk-banner-copy">
        <p className="voice-desk-banner-title">Suggest reply</p>
        <p className="voice-empty">{voiceUnlockCopy(voice)}</p>
        {voice &&
        (voice.status === "insufficient" || voice.conversationCount > 0) ? (
          <UnlockMeter voice={voice} />
        ) : null}
      </div>
      <div className="voice-desk-banner-actions">
        <button type="button" className="ghost" onClick={onOpenSettings}>
          Voice
        </button>
      </div>
    </aside>
  );
}

/** Locked teaser on an open Scout thread so the button is never a secret. */
export function SuggestLocked({
  voice,
  onOpenSettings,
}: {
  voice: VoiceState | null;
  busy?: boolean;
  onLearn?: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="suggest-pane suggest-locked">
      <p className="suggest-banner" role="note">
        Suggest reply — locked
      </p>
      <p className="voice-empty">{voiceUnlockCopy(voice)}</p>
      {voice && voice.conversationCount > 0 ? <UnlockMeter voice={voice} /> : null}
      <div className="suggest-actions">
        <button type="button" className="ghost" onClick={onOpenSettings}>
          What unlocks this
        </button>
      </div>
    </div>
  );
}
