import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
  type TransitionEvent,
} from "react";
import { HasTipButton, HasTipLink } from "./HasTip";
import { useDeskRowExpand } from "./useDeskRowExpand";

const ACTION_EXIT_MS = 240;
const ACTION_EXIT_FALLBACK_MS = ACTION_EXIT_MS + 80;

type ActionEdge = "start" | "end";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function useActionExit(shown: boolean) {
  const [mounted, setMounted] = useState(shown);

  useEffect(() => {
    if (shown) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    if (prefersReducedMotion()) {
      setMounted(false);
      return;
    }
    const timer = window.setTimeout(
      () => setMounted(false),
      ACTION_EXIT_FALLBACK_MS,
    );
    return () => window.clearTimeout(timer);
  }, [shown, mounted]);

  return { mounted, finish: () => setMounted(false) };
}

function ActionUnit({
  shown,
  edge,
  children,
}: {
  shown: boolean;
  edge: ActionEdge;
  children: ReactNode;
}) {
  const cached = useRef<ReactNode>(null);
  if (shown) cached.current = children;
  const exit = useActionExit(shown);
  const leaving = !shown;
  if (leaving && (!exit.mounted || prefersReducedMotion())) return null;
  if (cached.current == null) return null;

  const onTransitionEnd = (event: TransitionEvent<HTMLSpanElement>) => {
    if (event.target === event.currentTarget && event.propertyName === "transform") {
      exit.finish();
    }
  };

  return (
    <span
      className={leaving ? "row-action is-leaving" : "row-action"}
      data-edge={edge}
      aria-hidden={leaving || undefined}
      {...(leaving ? { inert: "" } : {})}
    >
      <span
        className="row-action-track"
        onTransitionEnd={leaving ? onTransitionEnd : undefined}
      >
        {cached.current}
      </span>
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
  // A row that cannot expand always shows its detail, so count it as open. A row
  // that becomes expandable while open then keeps `open` instead of replaying the enter.
  const presence = useDeskRowExpand(open || !expandable);
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
  const hasActions =
    openHref != null ||
    openLabel != null ||
    secondaryOpenHref != null ||
    onNext ||
    (onPrimary && primaryLabel) ||
    onBypass ||
    onSkip ||
    onDismiss;
  const actionRowExit = useActionExit(Boolean(hasActions));

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
      {hasActions || actionRowExit.mounted ? (
        <div
          className="row"
          onClick={(event) => event.stopPropagation()}
        >
          <ActionUnit
            shown={Boolean(openLabel || (secondaryOpenHref && secondaryOpenLabel))}
            edge="end"
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
          </ActionUnit>
          <ActionUnit shown={Boolean(onPrimary && primaryLabel)} edge="start">
            {onPrimary && primaryLabel ? (
              <ActionButton
                className="primary"
                disabled={busy}
                label={primaryLabel}
                onClick={onPrimary}
                tip={primaryTip}
              />
            ) : null}
          </ActionUnit>
          <ActionUnit shown={Boolean(onNext)} edge="start">
            {onNext ? (
              <ActionButton
                className="primary"
                disabled={busy || nextDisabled}
                label="Next"
                onClick={onNext}
                tip={nextTip}
              />
            ) : null}
          </ActionUnit>
          <ActionUnit shown={Boolean(onBypass)} edge="start">
            {onBypass ? (
              <ActionButton
                className="ghost"
                label={bypassLabel}
                onClick={onBypass}
              />
            ) : null}
          </ActionUnit>
          <ActionUnit shown={Boolean(onSkip || onDismiss)} edge="start">
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
          </ActionUnit>
        </div>
      ) : null}
      {(expandable ? presence.mount : Boolean(children)) ? (
        <div
          className="row-detail-slot"
          aria-hidden={!detailVisible}
          {...(!detailVisible
            ? { inert: "" }
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
