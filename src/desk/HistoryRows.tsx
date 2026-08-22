import { formatAbsoluteTime, formatTimeAgo } from "../lib/timeAgo";
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
    <article
      className="history-row"
      style={{ ["--i" as string]: index }}
    >
      <div className="history-row-body">
        <span className="row-summary">{blurb}</span>
        <span className="row-meta">
          <span>{entry.author}</span>
          {ago ? <span title={absolute ?? undefined}>{ago}</span> : null}
          <span className="chip">skipped</span>
        </span>
      </div>
    </article>
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
    <article
      className="history-row"
      style={{ ["--i" as string]: index }}
    >
      <div className="history-row-body">
        <span className="row-summary">{blurb}</span>
        <span className="row-meta">
          <span>{entry.author}</span>
          {ago ? <span title={absolute ?? undefined}>{ago}</span> : null}
          <span className="chip">not interested</span>
        </span>
        {entry.reason ? (
          <span className="row-meta">{entry.reason}</span>
        ) : null}
      </div>
      {entry.url ? (
        <div className="history-row-actions">
          <a className="ghost" href={entry.url} target="_blank" rel="noreferrer">
            Open on X
          </a>
        </div>
      ) : null}
    </article>
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
    <article
      className="history-row"
      style={{ ["--i" as string]: index }}
    >
      <div className="history-row-body">
        <span className="row-summary">{blurb}</span>
        <span className="row-meta">
          <span>{entry.author}</span>
          {tweetAgo ? (
            <span title={absolute ?? undefined}>{tweetAgo}</span>
          ) : null}
          <span className="chip">expired</span>
          {expiredAgo ? <span>moved {expiredAgo}</span> : null}
        </span>
      </div>
      {entry.url ? (
        <div className="history-row-actions">
          <a className="ghost" href={entry.url} target="_blank" rel="noreferrer">
            Open on X
          </a>
        </div>
      ) : null}
    </article>
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
    <article
      className="history-row"
      style={{ ["--i" as string]: index }}
    >
      <div className="history-row-body">
        <span className="row-summary">{blurb}</span>
        <span className="row-meta">
          <span>{entry.author}</span>
          {ago ? <span title={absolute ?? undefined}>{ago}</span> : null}
          <span className="chip chip-interacted">interacted</span>
          {t1hLabel ? <span className="chip">{t1hLabel}</span> : null}
          {t24hLabel ? <span className="chip">{t24hLabel}</span> : null}
        </span>
      </div>
      {entry.url || replyHref ? (
        <div className="history-row-actions">
          {entry.url ? (
            <a className="ghost" href={entry.url} target="_blank" rel="noreferrer">
              Open on X
            </a>
          ) : null}
          {replyHref ? (
            <a className="ghost" href={replyHref} target="_blank" rel="noreferrer">
              Open reply
            </a>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
