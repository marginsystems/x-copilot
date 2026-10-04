import {
  FYP_COMPOSE_TIP,
  FYP_NEXT_TIP,
  forYouKindClass,
  forYouKindLabel,
  forYouKindShort,
  forYouOpenUrl,
  forYouTargetId,
  type ForYouSuggestion,
} from "../../../shared/src/forYou";
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
  const detected = interacted === true && detectsReply;

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
      openHref={detected ? null : openUrl}
      openPace={openPace}
      openLabel={detected ? undefined : "Open on X"}
      openTip={row.kind === "post" ? FYP_COMPOSE_TIP : "Open this post on X."}
      onNext={detectsReply ? onNext : undefined}
      nextTip={FYP_NEXT_TIP}
      nextDisabled={!interacted}
      onPrimary={!interacted && !detectsReply && !busy ? onPosted : undefined}
      primaryLabel="I posted on X"
      onSkip={!interacted ? onSkip : undefined}
      onDismiss={!interacted ? onDismiss : undefined}
      busy={busy}
    />
  );
}
