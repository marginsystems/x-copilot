import { FYP_NEXT_TIP } from "../../../shared/src/forYou";
import { stripMediaShortlinksFromText } from "../lib/mediaText";
import { formatAbsoluteTime, formatTimeAgo } from "../lib/timeAgo";
import { ApproachDetectingMark } from "./ApproachFrame";
import { DeskRow } from "./DeskRow";
import type { OpenPace } from "./RowOpen";
import { ScoutTankMark } from "./ScoutTankMark";
import { baitClass, baitRisk } from "./threadHelpers";
import type { ThreadCard } from "../../../shared/src/deskTypes";

export function ThreadRow({
  thread,
  busy,
  interacted,
  detecting,
  onSkip,
  onDismiss,
  onNext,
  onWatch,
  openPace = null,
  index,
  exiting,
}: {
  thread: ThreadCard;
  busy: boolean;
  interacted: boolean;
  detecting?: boolean;
  onSkip: () => void;
  onDismiss: () => void;
  onNext?: () => void;
  onWatch?: () => void;
  openPace?: OpenPace | null;
  index?: number;
  exiting?: boolean;
}) {
  const bait = baitRisk(thread);
  const ago = formatTimeAgo(thread.createdAt);
  const absolute = formatAbsoluteTime(thread.createdAt);
  const displayText = stripMediaShortlinksFromText(
    thread.text,
    thread.mediaShortlinks,
  );

  return (
    <DeskRow
      className={thread.engage === "skip" ? "skip" : undefined}
      index={index}
      exiting={exiting}
      lead={bait ?? "\u00a0"}
      leadTitle={
        bait !== null ? "Engagement-bait risk — higher is worse" : undefined
      }
      leadClassName={baitClass(bait)}
      summary={thread.summary ?? displayText}
      meta={
        <>
          <ScoutTankMark />
          <span>{thread.author}</span>
          {ago ? <span title={absolute ?? undefined}>{ago}</span> : null}
          {interacted ? (
            <span className="chip chip-interacted">interacted</span>
          ) : detecting ? (
            <ApproachDetectingMark />
          ) : null}
          {bait !== null &&
          (thread.engage === "skip" || thread.engage === "priority") ? (
            <span className={`chip chip-${thread.engage}`}>
              {thread.engage}
            </span>
          ) : null}
        </>
      }
      openHref={interacted ? null : thread.url}
      openLabel={interacted ? undefined : "Open on X"}
      openTip="Open this reply on X."
      onOpen={onWatch}
      openPace={openPace}
      onNext={onNext}
      nextTip={FYP_NEXT_TIP}
      nextDisabled={!interacted}
      onSkip={!interacted ? onSkip : undefined}
      onDismiss={!interacted ? onDismiss : undefined}
      busy={busy}
    />
  );
}
