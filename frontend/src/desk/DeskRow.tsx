import {
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from "react";
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
  const classes = ["thread-row"];
  if (className) classes.push(className);
  if (exiting) classes.push("is-exiting");

  const style =
    index != null
      ? ({ ["--i" as string]: index } as CSSProperties)
      : undefined;
  return (
    <article
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
        actions={[
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
                label="Next"
                onClick={onNext}
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
        ]}
      />
    </article>
  );
}
