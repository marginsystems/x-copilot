import type { ReactNode } from "react";
import { stripMediaShortlinksFromText } from "../lib/mediaText";
import { formatAbsoluteTime, formatTimeAgo } from "../lib/timeAgo";
import { XThreadView } from "../XThreadView";
import { DeskRow } from "./DeskRow";
import { baitClass, baitRisk } from "./threadHelpers";
import type { ThreadCard } from "./types";

export function ThreadRow({
  thread,
  open,
  busy,
  interacted,
  onToggle,
  onMark,
  onSkip,
  onDismiss,
  onWatch,
  suggest,
  index,
  exiting,
}: {
  thread: ThreadCard;
  open: boolean;
  busy: boolean;
  interacted: boolean;
  onToggle: () => void;
  onMark: () => void;
  onSkip: () => void;
  onDismiss: () => void;
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
          <span>{thread.author}</span>
          {ago ? <span title={absolute ?? undefined}>{ago}</span> : null}
          {interacted ? (
            <span className="chip chip-interacted">interacted</span>
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
      <div className="row">
        <a
          className="ghost"
          href={thread.url}
          target="_blank"
          rel="noreferrer"
          onClick={() => onWatch?.()}
        >
          Open on X
        </a>
        <button
          className="primary"
          disabled={busy || interacted}
          onClick={onMark}
        >
          {interacted ? "Interacted" : "I posted on X"}
        </button>
        <button
          className="ghost"
          disabled={busy || interacted}
          onClick={onSkip}
        >
          Skip
        </button>
        <button
          className="ghost"
          disabled={busy || interacted}
          onClick={onDismiss}
        >
          Not interested
        </button>
      </div>
      {!interacted ? suggest : null}
    </DeskRow>
  );
}
