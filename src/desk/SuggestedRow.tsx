import {
  forYouComposeSeed,
  forYouKindLabel,
  forYouOpenUrl,
  forYouUsesDeskCompose,
  type ForYouSuggestion,
} from "../lib/forYou";
import type { VoiceState } from "../lib/voice";
import { SuggestPane } from "../SuggestPane";
import { SuggestLocked } from "../VoiceCard";

export function SuggestedRow({
  row,
  index = 0,
  busy,
  voice,
  agenda,
  xLinked,
  hasSession,
  onPosted,
  onSkip,
  onDismiss,
  onOpenSettings,
  onLinkX,
  onUsage,
}: {
  row: ForYouSuggestion;
  index?: number;
  busy: boolean;
  voice: VoiceState | null;
  agenda: string;
  xLinked?: boolean;
  hasSession: boolean;
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
  return (
    <article
      className="history-row for-you-row"
      style={{ ["--i" as string]: index }}
    >
      <div className="history-row-body">
        <span className="row-meta">
          <span className="chip">{forYouKindLabel(row.kind)}</span>
          {row.targetAuthor ? <span>{row.targetAuthor}</span> : null}
        </span>
        <span className="row-summary">{row.why}</span>
        {!compose && row.draft ? (
          <span className="for-you-draft">{row.draft}</span>
        ) : null}
      </div>
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
        <div className="history-row-actions">
          {openUrl ? (
            <a className="ghost" href={openUrl} target="_blank" rel="noreferrer">
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
      <div className="history-row-actions">
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
    </article>
  );
}
