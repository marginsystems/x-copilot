import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { HasTipButton, HasTipLink } from "./HasTip";
import { useDeskRowExpand } from "./useDeskRowExpand";

const ACTION_COLLAPSE_MS = 240;

/** Keep a departing action mounted so the row can collapse it instead of popping. */
function useActionPresence(active: boolean) {
  const [mounted, setMounted] = useState(active);
  const [open, setOpen] = useState(active);

  useEffect(() => {
    if (active) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(frame);
    }
    setOpen(false);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(
      () => setMounted(false),
      reduce ? 0 : ACTION_COLLAPSE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [active]);

  return { mounted, open };
}

function ActionSlot({
  shown,
  children,
}: {
  shown: boolean;
  children: ReactNode;
}) {
  const cached = useRef<ReactNode>(null);
  if (children != null) cached.current = children;
  const presence = useActionPresence(shown && cached.current != null);
  if (!presence.mounted || cached.current == null) return null;
  return (
    <span
      className={presence.open ? "row-action" : "row-action is-collapsed"}
      aria-hidden={presence.open ? undefined : true}
      {...(!presence.open
        ? ({ inert: "" } as HTMLAttributes<HTMLSpanElement>)
        : {})}
    >
      <span className="row-action-clip">{cached.current}</span>
    </span>
  );
}

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
          <ActionSlot shown={openLabel != null}>
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
          </ActionSlot>
          <ActionSlot shown={Boolean(secondaryOpenHref && secondaryOpenLabel)}>
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
          </ActionSlot>
          <ActionSlot shown={Boolean(onPrimary && primaryLabel)}>
            {onPrimary && primaryLabel ? (
              <ActionButton
                className="primary"
                disabled={busy}
                label={primaryLabel}
                onClick={onPrimary}
                tip={primaryTip}
              />
            ) : null}
          </ActionSlot>
          <ActionSlot shown={Boolean(onNext)}>
            {onNext ? (
              <ActionButton
                className="primary"
                disabled={busy || nextDisabled}
                label="Next"
                onClick={onNext}
                tip={nextTip}
              />
            ) : null}
          </ActionSlot>
          <ActionSlot shown={Boolean(onBypass)}>
            {onBypass ? (
              <ActionButton
                className="ghost"
                label={bypassLabel}
                onClick={onBypass}
              />
            ) : null}
          </ActionSlot>
          <ActionSlot shown={Boolean(onSkip)}>
            {onSkip ? (
              <ActionButton
                className="ghost"
                disabled={busy}
                label="Skip"
                onClick={onSkip}
              />
            ) : null}
          </ActionSlot>
          <ActionSlot shown={Boolean(onDismiss)}>
            {onDismiss ? (
              <ActionButton
                className="ghost"
                disabled={busy}
                label="Not interested"
                onClick={onDismiss}
              />
            ) : null}
          </ActionSlot>
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
