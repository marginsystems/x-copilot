import {
  forYouComposeSeed,
  forYouKindClass,
  forYouKindLabel,
  forYouKindShort,
  forYouOpenUrl,
  forYouUsesDeskCompose,
  type ForYouSuggestion,
} from "../lib/forYou";
import type { VoiceState } from "../lib/voice";
import { SuggestPane } from "../SuggestPane";
import { SuggestLocked } from "../VoiceCard";

export function SuggestedRow({
  row,
  open,
  busy,
  voice,
  agenda,
  xLinked,
  hasSession,
  onToggle,
  onPosted,
  onSkip,
  onDismiss,
  onOpenSettings,
  onLinkX,
  onUsage,
}: {
  row: ForYouSuggestion;
  open: boolean;
  busy: boolean;
  voice: VoiceState | null;
  agenda: string;
  xLinked?: boolean;
  hasSession: boolean;
  onToggle: () => void;
  onPosted: () => void;
  onSkip: () => void;
  onDismiss: () => void;
  onOpenSettings: () => void;
  onLinkX: () => void;
  onUsage: (usage: VoiceState["suggests"]) => void;
}) {
  const openUrl = forYouOpenUrl(row);
  const compose = forYouUsesDeskCompose(row);
  const seed = forYouComposeSeed(row);
  const handle = voice?.handle ? `@${voice.handle}` : "@you";
  const kindClass = forYouKindClass(row.kind);
  const classes = ["thread-row", "for-you-row", kindClass];
  if (open) classes.push("open");

  return (
    <article className={classes.join(" ")}>
      <button
        type="button"
        className="row-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span
          className={`bait ${kindClass}`}
          title={forYouKindLabel(row.kind)}
        >
          {forYouKindShort(row.kind)}
        </span>
        <span className="row-main">
          <span className="row-summary">{row.why}</span>
          <span className="row-meta">
            <span className="chip">{forYouKindLabel(row.kind)}</span>
            {row.targetAuthor ? <span>{row.targetAuthor}</span> : null}
          </span>
        </span>
        <span className="caret" aria-hidden="true">
          {open ? "–" : "+"}
        </span>
      </button>

      <div className="row-detail">
        {!compose && row.draft ? (
          <p className="for-you-draft">{row.draft}</p>
        ) : null}
        {compose ? (
          voice?.status === "ready" && voice.unlocked && seed ? (
            <SuggestPane
              variant="compose"
              composeKind={row.kind === "quote" ? "quote" : "post"}
              suggestionId={row.id}
              quoteTweetId={row.targetId}
              threadId={row.id}
              author={row.targetAuthor || handle}
              text={seed}
              agenda={agenda}
              usage={voice.suggests}
              onUsage={onUsage}
              onDeskPosted={onPosted}
            />
          ) : (
            <SuggestLocked
              voice={voice}
              xLinked={xLinked}
              hasSession={hasSession}
              lockNoun="post"
              onOpenSettings={onOpenSettings}
              onLinkX={onLinkX}
            />
          )
        ) : (
          <div className="row">
            {openUrl ? (
              <a
                className="ghost"
                href={openUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open on X
              </a>
            ) : (
              <button type="button" className="ghost" disabled>
                Open on X
              </button>
            )}
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={onPosted}
            >
              I posted on X
            </button>
          </div>
        )}
        <div className="row">
          {compose ? (
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={onPosted}
            >
              I posted on X
            </button>
          ) : null}
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={onSkip}
          >
            Skip
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={onDismiss}
          >
            Not interested
          </button>
        </div>
      </div>
    </article>
  );
}
