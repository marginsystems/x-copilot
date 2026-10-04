import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import {
  NEXT_CONFIRM_KEEP_LABEL,
  NEXT_CONFIRM_SKIP_LABEL,
  NEXT_LABEL,
  nextAskActive,
  nextClick,
  nextConfirmCopy,
  type NextAsk,
  type NextConfirmSubject,
} from "../../../shared/src/nextConfirm";
import { DeskRowActions } from "./DeskRowActions";
import { HasTipButton, HasTipLink } from "./HasTip";
import { PacedOpenButton, ReadyOpenLink, type OpenPace } from "./RowOpen";

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

export type AskBeforeNext = { subject: NextConfirmSubject; cardKey: string };

function NextConfirm({
  subject,
  onSkip,
  onKeep,
}: {
  subject: NextConfirmSubject;
  onSkip: () => void;
  onKeep: () => void;
}) {
  const noteId = useId();
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onKeep();
  }

  return (
    <span
      className="next-confirm"
      role="group"
      aria-describedby={noteId}
      onKeyDown={onKeyDown}
    >
      <span id={noteId} className="next-confirm-note">
        {nextConfirmCopy(subject)}
      </span>
      <button type="button" className="primary" onClick={onSkip}>
        {NEXT_CONFIRM_SKIP_LABEL}
      </button>
      <button type="button" className="ghost" ref={keepRef} onClick={onKeep}>
        {NEXT_CONFIRM_KEEP_LABEL}
      </button>
    </span>
  );
}

export function DeskRow({
  className,
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
  openPace,
  onNext,
  askBeforeNext,
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
  index,
  exiting = false,
}: {
  className?: string;
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
  openPace?: OpenPace | null;
  onNext?: () => void;
  askBeforeNext?: AskBeforeNext;
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
  index?: number;
  exiting?: boolean;
}) {
  const articleRef = useRef<HTMLElement>(null);
  const [ask, setAsk] = useState<NextAsk | null>(null);
  const restoreNextFocus = useRef(false);
  const asking =
    askBeforeNext !== undefined &&
    onNext !== undefined &&
    nextAskActive(ask, {
      detected: false,
      cardKey: askBeforeNext.cardKey,
    });

  if (ask !== null && !asking) setAsk(null);

  useEffect(() => {
    if (asking || !restoreNextFocus.current) return;
    restoreNextFocus.current = false;
    articleRef.current
      ?.querySelector<HTMLElement>('[data-action="next"] button')
      ?.focus();
  }, [asking]);

  function clickNext() {
    if (!askBeforeNext) {
      onNext?.();
      return;
    }
    const outcome = nextClick({ detected: false, cardKey: askBeforeNext.cardKey });
    if (outcome.action === "ask") setAsk(outcome.ask);
  }

  function keepWaiting() {
    restoreNextFocus.current = true;
    setAsk(null);
  }

  function confirmSkip() {
    setAsk(null);
    onNext?.();
  }

  const classes = ["thread-row"];
  if (className) classes.push(className);
  if (exiting) classes.push("is-exiting");

  const style =
    index != null
      ? ({ ["--i" as string]: index } as CSSProperties)
      : undefined;
  return (
    <article
      ref={articleRef}
      className={classes.join(" ")}
      style={style}
      aria-busy={ariaBusy || undefined}
      role={status ? "status" : undefined}
    >
      <div className="row-head">
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
      </div>
      <DeskRowActions
        actions={
          asking && askBeforeNext
            ? [
                {
                  key: "next-confirm",
                  node: (
                    <NextConfirm
                      subject={askBeforeNext.subject}
                      onSkip={confirmSkip}
                      onKeep={keepWaiting}
                    />
                  ),
                },
              ]
            : [
          {
            key: "open",
            node: openPace && openLabel && openHref ? (
              <PacedOpenButton label={openLabel} pace={openPace} />
            ) : openPace !== undefined && openLabel && openHref ? (
              <ReadyOpenLink
                href={openHref}
                label={openLabel}
                tip={openTip ?? openLabel}
                onClick={onOpen}
              />
            ) : openLabel ? (
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
            ) : null,
          },
          {
            key: "open-secondary",
            node:
              secondaryOpenHref && secondaryOpenLabel && !openPace ? (
                openPace === null ? (
                  <ReadyOpenLink
                    href={secondaryOpenHref}
                    label={secondaryOpenLabel}
                    tip={secondaryOpenTip ?? secondaryOpenLabel}
                  />
                ) : (
                  <HasTipLink
                    className="ghost"
                    href={secondaryOpenHref}
                    target="_blank"
                    rel="noreferrer"
                    tip={secondaryOpenTip ?? secondaryOpenLabel}
                  >
                    {secondaryOpenLabel}
                  </HasTipLink>
                )
              ) : null,
          },
          {
            key: "primary",
            node:
              onPrimary && primaryLabel ? (
                <ActionButton
                  className="primary"
                  disabled={busy}
                  label={primaryLabel}
                  onClick={onPrimary}
                  tip={primaryTip}
                />
              ) : null,
          },
          {
            key: "next",
            node: onNext ? (
              <ActionButton
                className="primary"
                disabled={busy || nextDisabled}
                label={NEXT_LABEL}
                onClick={clickNext}
                tip={nextTip}
              />
            ) : null,
          },
          {
            key: "bypass",
            node: onBypass ? (
              <ActionButton
                className="ghost"
                label={bypassLabel}
                onClick={onBypass}
              />
            ) : null,
          },
          {
            key: "skip",
            node:
              onSkip || onDismiss ? (
                <>
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
                </>
              ) : null,
          },
        ]
        }
      />
    </article>
  );
}
