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
import { ApproachDetectingMark } from "./ApproachFrame";
import { DeskRow } from "./DeskRow";

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
  interacted,
  detecting,
  onNext,
  onSkip,
  onDismiss,
  onOpenSettings,
  onLinkX,
  onUsage,
  index,
  exiting,
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
  interacted?: boolean;
  detecting?: boolean;
  onNext?: () => void;
  onSkip: () => void;
  onDismiss: () => void;
  onOpenSettings: () => void;
  onLinkX: () => void;
  onUsage: (usage: VoiceState["suggests"]) => void;
  index?: number;
  exiting?: boolean;
}) {
  const openUrl = forYouOpenUrl(row);
  const compose = forYouUsesDeskCompose(row);
  const seed = forYouComposeSeed(row);
  const handle = voice?.handle ? `@${voice.handle}` : "@you";
  const kindClass = forYouKindClass(row.kind);
  const detectsReply = row.kind === "reply" && Boolean(row.targetId);

  return (
    <DeskRow
      className={`for-you-row ${kindClass}`}
      open={open}
      expandable
      index={index}
      exiting={exiting}
      lead={forYouKindShort(row.kind)}
      leadTitle={forYouKindLabel(row.kind)}
      leadClassName={`bait ${kindClass}`}
      summary={row.why}
      meta={
        <>
          <span className={interacted ? "chip chip-interacted" : "chip"}>
            {interacted ? "interacted" : forYouKindLabel(row.kind)}
          </span>
          {!interacted && detecting ? <ApproachDetectingMark /> : null}
          {!interacted && row.targetAuthor ? (
            <span>{row.targetAuthor}</span>
          ) : null}
        </>
      }
      onToggle={onToggle}
      openHref={openUrl}
      openLabel="Open on X"
      openTip="Open the target on X."
      onNext={detectsReply ? onNext : undefined}
      nextTip="Continue to the next Approach card."
      nextDisabled={!interacted}
      onPrimary={
        open && !interacted && !detectsReply && !busy ? onPosted : undefined
      }
      primaryLabel="I posted on X"
      onSkip={open && !interacted ? onSkip : undefined}
      onDismiss={open && !interacted ? onDismiss : undefined}
      busy={busy}
    >
      {!compose && row.draft ? (
        <p className="for-you-draft">{row.draft}</p>
      ) : null}
      {compose && voice?.status === "ready" && voice.unlocked && seed ? (
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
      ) : compose ? (
        <SuggestLocked
          voice={voice}
          xLinked={xLinked}
          hasSession={hasSession}
          lockNoun="post"
          onOpenSettings={onOpenSettings}
          onLinkX={onLinkX}
        />
      ) : null}
    </DeskRow>
  );
}
