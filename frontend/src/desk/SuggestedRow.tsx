import {
  FYP_COMPOSE_TIP,
  forYouKindClass,
  forYouKindLabel,
  forYouKindShort,
  forYouOpenUrl,
  forYouTargetId,
  type ForYouSuggestion,
} from "../lib/forYou";
import { ApproachDetectingMark } from "./ApproachFrame";
import { DeskRow } from "./DeskRow";
import type { OpenPace } from "./RowOpen";

export function SuggestedRow({
  row,
  busy,
  onPosted,
  interacted,
  detecting,
  onNext,
  onSkip,
  onDismiss,
  index,
  exiting,
  openPace = null,
}: {
  row: ForYouSuggestion;
  busy: boolean;
  onPosted: () => void;
  interacted?: boolean;
  detecting?: boolean;
  onNext?: () => void;
  onSkip: () => void;
  onDismiss: () => void;
  index?: number;
  exiting?: boolean;
  openPace?: OpenPace | null;
}) {
  const openUrl = forYouOpenUrl(row);
  const kindClass = forYouKindClass(row.kind);
  const detectsReply = row.kind === "reply" && Boolean(forYouTargetId(row));

  return (
    <DeskRow
      className={`for-you-row ${kindClass}`}
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
      openHref={openUrl}
      openPace={openPace}
      openLabel="Open on X"
      openTip={row.kind === "post" ? FYP_COMPOSE_TIP : "Open the target on X."}
      onNext={detectsReply ? onNext : undefined}
      nextTip="Continue to the next Approach card."
      nextDisabled={!interacted}
      onPrimary={!interacted && !detectsReply && !busy ? onPosted : undefined}
      primaryLabel="I posted on X"
      onSkip={!interacted ? onSkip : undefined}
      onDismiss={!interacted ? onDismiss : undefined}
      busy={busy}
    />
  );
}
