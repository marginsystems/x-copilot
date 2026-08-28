import type { CSSProperties, ReactNode } from "react";
import { useDeskRowExpand } from "./useDeskRowExpand";

export function DeskRow({
  className,
  open = false,
  expandable = false,
  lead,
  leadTitle,
  leadClassName,
  summary,
  meta,
  onToggle,
  index,
  exiting = false,
  children,
}: {
  className?: string;
  open?: boolean;
  expandable?: boolean;
  lead: ReactNode;
  leadTitle?: string;
  leadClassName?: string;
  summary?: ReactNode;
  meta?: ReactNode;
  onToggle?: () => void;
  index?: number;
  exiting?: boolean;
  children?: ReactNode;
}) {
  const presence = useDeskRowExpand(Boolean(expandable && open));
  const classes = ["thread-row"];
  if (className) classes.push(className);
  if (presence.expanded) classes.push("open");
  if (exiting) classes.push("is-exiting");

  const style =
    index != null
      ? ({ ["--i" as string]: index } as CSSProperties)
      : undefined;

  const head = (
    <>
      <div
        className={["row-lead", leadClassName ?? "bait"].filter(Boolean).join(" ")}
        title={leadTitle}
      >
        {lead}
      </div>
      <div className="row-main">
        {summary != null ? <div className="row-summary">{summary}</div> : null}
        {meta != null ? <div className="row-meta">{meta}</div> : null}
      </div>
      {expandable ? (
        <div className="caret" aria-hidden="true">
          {presence.expanded ? "–" : "+"}
        </div>
      ) : null}
    </>
  );

  return (
    <article className={classes.join(" ")} style={style}>
      {expandable && onToggle ? (
        <button
          type="button"
          className="row-head"
          aria-expanded={presence.expanded}
          onClick={onToggle}
        >
          {head}
        </button>
      ) : (
        <div className="row-head next-action-head">{head}</div>
      )}
      {presence.mount ? (
        <div
          className="row-detail-slot"
          aria-hidden={!presence.expanded}
        >
          <div className="row-detail-inner">
            <div className="row-detail">{children}</div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
