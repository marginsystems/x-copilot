import type { ReactNode } from "react";
import { stripMediaShortlinksFromText } from "../lib/mediaText";
import { formatAbsoluteTime, formatTimeAgo } from "../lib/timeAgo";
import { XThreadView } from "../XThreadView";
import { ApproachDetectingMark } from "./ApproachFrame";
import { DeskRow } from "./DeskRow";
import { ScoutTankMark } from "./ScoutTankMark";
import { baitClass, baitRisk } from "./threadHelpers";
import type { ThreadCard } from "./types";

export function ThreadRow({
  thread,
  open,
  busy,
  interacted,
  detecting,
  onToggle,
  onSkip,
  onDismiss,
  onNext,
  onWatch,
  suggest,
  index,
  exiting,
}: {
  thread: ThreadCard;
  open: boolean;
  busy: boolean;
  interacted: boolean;
  detecting?: boolean;
  onToggle: () => void;
  onSkip: () => void;
  onDismiss: () => void;
  onNext?: () => void;
  onWatch?: () => void;
  suggest?: ReactNode;
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
  const tags = [
    ...new Set(
      [thread.threadKind, thread.intent, ...(thread.flags ?? [])].filter(
        Boolean,
      ),
    ),
  ];

  return (
    <DeskRow
      className={thread.engage === "skip" ? "skip" : undefined}
      open={open}
      expandable
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
      onToggle={onToggle}
      openHref={thread.url}
      openLabel="Open on X"
      openTip="Open this reply on X."
      onOpen={onWatch}
      onNext={onNext}
      nextTip="Continue to the next Approach card."
      nextDisabled={!interacted}
      onSkip={open && !interacted ? onSkip : undefined}
      onDismiss={open && !interacted ? onDismiss : undefined}
      busy={busy}
    >
      <XThreadView
        author={thread.author}
        text={displayText}
        createdAt={thread.createdAt}
        opAuthor={thread.opAuthor}
        opText={
          thread.opText
            ? stripMediaShortlinksFromText(
                thread.opText,
                thread.mediaShortlinks,
              )
            : undefined
        }
        isReply={thread.isReply}
        isQuote={thread.isQuote}
        inReplyToId={thread.inReplyToId}
      />
      {thread.reason ? <p className="reason">{thread.reason}</p> : null}
      {tags.length > 0 ? (
        <div className="tags">
          {tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      {!interacted ? suggest : null}
    </DeskRow>
  );
}
