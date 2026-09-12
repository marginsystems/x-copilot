import type {
  CSSProperties,
  HTMLAttributes,
  MouseEventHandler,
  ReactNode,
} from "react";
import { HasTipButton, HasTipLink } from "./HasTip";
import { useDeskRowExpand } from "./useDeskRowExpand";

function ActionButton({
  label,
  className,
  tip,
  disabled,
  onClick,
}: {
  label: string;
  className: "ghost" | "primary";
  tip?: string;
  disabled?: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
}) {
  return tip ? (
    <HasTipButton
      className={className}
      disabled={disabled}
      onClick={onClick}
      tip={tip}
    >
      {label}
    </HasTipButton>
  ) : (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function DeskRow({
  className,
  open = false,
  expandable = false,
  lead,
  leadTitle,
  leadClassName,
  summary,
  meta,
  openHref,
  openLabel,
  openTip,
  onOpen,
  secondaryOpenHref,
  secondaryOpenLabel,
  secondaryOpenTip,
  onNext,
  nextTip,
  nextDisabled = false,
  onPrimary,
  primaryLabel,
  primaryTip,
  onBypass,
  bypassLabel = "Bypass",
  onSkip,
  onDismiss,
  busy = false,
  ariaBusy,
  status = false,
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
  openHref?: string | null;
  openLabel?: string;
  openTip?: string;
  onOpen?: () => void;
  secondaryOpenHref?: string | null;
  secondaryOpenLabel?: string;
  secondaryOpenTip?: string;
  onNext?: () => void;
  nextTip?: string;
  nextDisabled?: boolean;
  onPrimary?: () => void;
  primaryLabel?: string;
  primaryTip?: string;
  onBypass?: () => void;
  bypassLabel?: string;
  onSkip?: () => void;
  onDismiss?: () => void;
  busy?: boolean;
  ariaBusy?: boolean;
  status?: boolean;
  onToggle?: () => void;
  index?: number;
  exiting?: boolean;
  children?: ReactNode;
}) {
  const presence = useDeskRowExpand(Boolean(expandable && open));
  const expanded = !expandable || presence.expanded;
  const detailVisible = !expandable || expanded;
  const classes = ["thread-row"];
  if (className) classes.push(className);
  if (expanded) classes.push("open");
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
    <article
      className={classes.join(" ")}
      style={style}
      aria-busy={ariaBusy || undefined}
      role={status ? "status" : undefined}
    >
      {expandable && onToggle ? (
        <button
          type="button"
          className="row-head"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {head}
        </button>
      ) : (
        <div className="row-head">{head}</div>
      )}
      {openHref != null ||
      openLabel != null ||
      secondaryOpenHref != null ||
      onNext ||
      (onPrimary && primaryLabel) ||
      onBypass ||
      onSkip ||
      onDismiss ? (
        <div
          className="row"
          onClick={(event) => event.stopPropagation()}
        >
          {openLabel ? (
            openHref ? (
              <HasTipLink
                className="ghost"
                href={openHref}
                target="_blank"
                rel="noreferrer"
                tip={openTip ?? openLabel}
                onClick={onOpen}
              >
                {openLabel}
              </HasTipLink>
            ) : (
              <button type="button" className="ghost" disabled>
                {openLabel}
              </button>
            )
          ) : null}
          {secondaryOpenHref && secondaryOpenLabel ? (
            <HasTipLink
              className="ghost"
              href={secondaryOpenHref}
              target="_blank"
              rel="noreferrer"
              tip={secondaryOpenTip ?? secondaryOpenLabel}
            >
              {secondaryOpenLabel}
            </HasTipLink>
          ) : null}
          {onPrimary && primaryLabel ? (
            <ActionButton
              className="primary"
              disabled={busy}
              label={primaryLabel}
              onClick={onPrimary}
              tip={primaryTip}
            />
          ) : null}
          {onNext ? (
            <ActionButton
              className="primary"
              disabled={busy || nextDisabled}
              label="Next"
              onClick={onNext}
              tip={nextTip}
            />
          ) : null}
          {onBypass ? (
            <ActionButton
              className="ghost"
              label={bypassLabel}
              onClick={onBypass}
            />
          ) : null}
          {onSkip ? (
            <ActionButton
              className="ghost"
              disabled={busy}
              label="Skip"
              onClick={onSkip}
            />
          ) : null}
          {onDismiss ? (
            <ActionButton
              className="ghost"
              disabled={busy}
              label="Not interested"
              onClick={onDismiss}
            />
          ) : null}
        </div>
      ) : null}
      {presence.mount || (!expandable && children) ? (
        <div
          className="row-detail-slot"
          aria-hidden={!detailVisible}
          {...(!detailVisible
            ? ({ inert: "" } as HTMLAttributes<HTMLDivElement>)
            : {})}
        >
          <div className="row-detail-inner">
            <div className="row-detail">{children}</div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
