import { formatAbsoluteTime, formatTimeAgo } from "../lib/timeAgo";
import { DeskRow } from "./DeskRow";
import type {
  DismissalHistoryEntry,
  ExpiredHistoryEntry,
  InteractionHistoryEntry,
  ReplyStatSnapshot,
  SkipHistoryEntry,
} from "./types";

export function formatStatChip(
  label: string,
  snap: ReplyStatSnapshot | undefined,
  pending: boolean,
): string {
  if (snap) {
    const views =
      typeof snap.views === "number" ? snap.views.toLocaleString() : "—";
    const likes =
      typeof snap.likes === "number" ? snap.likes.toLocaleString() : "—";
    return `${label}: ${views} views · ${likes} likes`;
  }
  if (pending) return `${label}: pending`;
  return "";
}

export function SkippedRow({
  entry,
  index = 0,
}: {
  entry: SkipHistoryEntry;
  index?: number;
}) {
  const ago = formatTimeAgo(entry.at);
  const absolute = formatAbsoluteTime(entry.at);
  const blurb = entry.summary || entry.text || entry.threadId;
  return (
    <DeskRow
      className="history-row"
      index={index}
      lead="SKIP"
      leadTitle="Skipped"
      summary={blurb}
      meta={
        <>
          <span>{entry.author}</span>
          {ago ? <span title={absolute ?? undefined}>{ago}</span> : null}
          <span className="chip">skipped</span>
        </>
      }
    />
  );
}

export function DismissedRow({
  entry,
  index = 0,
}: {
  entry: DismissalHistoryEntry;
  index?: number;
}) {
  const ago = formatTimeAgo(entry.at);
  const absolute = formatAbsoluteTime(entry.at);
  const blurb = entry.summary || entry.text || entry.threadId;
  return (
    <DeskRow
      className="history-row"
      index={index}
      lead="NO"
      leadTitle="Not interested"
      summary={blurb}
      meta={
        <>
          <span>{entry.author}</span>
          {ago ? <span title={absolute ?? undefined}>{ago}</span> : null}
          <span className="chip">not interested</span>
          {entry.reason ? <span>{entry.reason}</span> : null}
        </>
      }
      openHref={entry.url}
      openLabel={entry.url ? "Open on X" : undefined}
      openTip="Open this post on X."
    />
  );
}

export function ExpiredRow({
  entry,
  index = 0,
}: {
  entry: ExpiredHistoryEntry;
  index?: number;
}) {
  const tweetAgo = formatTimeAgo(entry.createdAt);
  const expiredAgo = formatTimeAgo(entry.at);
  const absolute = formatAbsoluteTime(entry.createdAt || entry.at);
  const blurb = entry.summary || entry.text || entry.threadId;
  return (
    <DeskRow
      className="history-row"
      index={index}
      lead="OLD"
      leadTitle="Expired"
      summary={blurb}
      meta={
        <>
          <span>{entry.author}</span>
          {tweetAgo ? (
            <span title={absolute ?? undefined}>{tweetAgo}</span>
          ) : null}
          <span className="chip">expired</span>
          {expiredAgo ? <span>moved {expiredAgo}</span> : null}
        </>
      }
      openHref={entry.url}
      openLabel={entry.url ? "Open on X" : undefined}
      openTip="Open this post on X."
    />
  );
}

export function InteractedRow({
  entry,
  index = 0,
}: {
  entry: InteractionHistoryEntry;
  index?: number;
}) {
  const ago = formatTimeAgo(entry.at);
  const absolute = formatAbsoluteTime(entry.at);
  const blurb = entry.summary || entry.text || entry.threadId;
  const hasReply = Boolean(entry.replyId);
  const t1hLabel = formatStatChip("1h", entry.stats?.t1h, hasReply);
  const t24hLabel = formatStatChip("24h", entry.stats?.t24h, hasReply);
  const replyHref = entry.replyUrl;
  return (
    <DeskRow
      className="history-row"
      index={index}
      lead="DONE"
      leadTitle="Interacted"
      summary={blurb}
      meta={
        <>
          <span>{entry.author}</span>
          {ago ? <span title={absolute ?? undefined}>{ago}</span> : null}
          <span className="chip chip-interacted">interacted</span>
          {t1hLabel ? <span className="chip">{t1hLabel}</span> : null}
          {t24hLabel ? <span className="chip">{t24hLabel}</span> : null}
        </>
      }
      openHref={entry.url}
      openLabel={entry.url ? "Open on X" : undefined}
      openTip="Open this post on X."
      secondaryOpenHref={replyHref}
      secondaryOpenLabel={replyHref ? "Open reply" : undefined}
      secondaryOpenTip="Open your reply on X."
    />
  );
}
