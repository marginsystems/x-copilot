import { formatAbsoluteTime, formatTimeAgo } from "./lib/timeAgo";
import {
  displayHandle,
  handleInitial,
  hasParentContext,
  parentKind,
} from "./lib/xThreadView";

export function XThreadView(props: {
  author: string;
  text: string;
  createdAt?: string;
  opAuthor?: string;
  opText?: string;
  isReply?: boolean;
  isQuote?: boolean;
  inReplyToId?: string;
}) {
  const parent = hasParentContext(props);
  const kind = parentKind(props);
  const parentHandle = parent ? displayHandle(props.opAuthor ?? "") : "";

  return (
    <div className={parent ? "x-thread" : "x-thread x-thread-solo"}>
      {parent ? (
        <XPostBlock
          author={props.opAuthor ?? ""}
          text={props.opText ?? ""}
          kicker={
            kind === "quote" ? "Quoted post" : `Replying to @${parentHandle}`
          }
          rail
        />
      ) : null}
      <XPostBlock
        author={props.author}
        text={props.text}
        createdAt={props.createdAt}
      />
    </div>
  );
}

function XPostBlock(props: {
  author: string;
  text: string;
  createdAt?: string;
  kicker?: string;
  rail?: boolean;
}) {
  const handle = displayHandle(props.author);
  const ago = formatTimeAgo(props.createdAt);
  const absolute = formatAbsoluteTime(props.createdAt ?? null);
  return (
    <div className={props.rail ? "x-post has-rail" : "x-post"}>
      <div className="x-post-gutter" aria-hidden="true">
        <span className="x-post-avatar">{handleInitial(handle)}</span>
        {props.rail ? <span className="x-post-rail" /> : null}
      </div>
      <div className="x-post-main">
        {props.kicker ? <p className="x-post-kicker">{props.kicker}</p> : null}
        <p className="x-post-head">
          <span className="x-post-name">@{handle}</span>
          {ago ? (
            <span className="x-post-time" title={absolute ?? undefined}>
              {ago}
            </span>
          ) : null}
        </p>
        <p className="x-post-text">{props.text}</p>
      </div>
    </div>
  );
}
