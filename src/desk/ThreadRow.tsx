import type { ReactNode } from "react";
import { stripMediaShortlinksFromText } from "../lib/mediaText";
import { formatAbsoluteTime, formatTimeAgo } from "../lib/timeAgo";
import { XThreadView } from "../XThreadView";
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
  const classes = ["thread-row"];
  if (open) classes.push("open");
  if (thread.engage === "skip") classes.push("skip");

  return (
    <article className={classes.join(" ")}>
      <button
        type="button"
        className="row-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        {bait !== null ? (
          <span
            className={baitClass(bait)}
            title="Engagement-bait risk — higher is worse"
          >
            {bait}
          </span>
        ) : (
          <span className="bait" aria-hidden="true" />
        )}
        <span className="row-main">
          <span className="row-summary">{thread.summary ?? displayText}</span>
          <span className="row-meta">
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
          </span>
        </span>
        <span className="caret" aria-hidden="true">
          {open ? "–" : "+"}
        </span>
      </button>

      {open ? (
        <div className="row-detail">
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
        </div>
      ) : null}
    </article>
  );
}
