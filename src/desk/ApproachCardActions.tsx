import { HasTipButton, HasTipLink } from "./HasTip";

export function ApproachCardActions({
  openHref,
  openLabel,
  openTip,
  onOpen,
  onNext,
  nextTip,
  busy = false,
  nextDisabled = false,
}: {
  openHref?: string;
  openLabel?: string;
  openTip?: string;
  onOpen?: () => void;
  onNext?: () => void;
  nextTip: string;
  busy?: boolean;
  nextDisabled?: boolean;
}) {
  return (
    <>
      {openHref && openLabel && openTip ? (
        <HasTipLink
          className="ghost"
          href={openHref}
          target="_blank"
          rel="noreferrer"
          tip={openTip}
          onClick={onOpen}
        >
          {openLabel}
        </HasTipLink>
      ) : null}
      {onNext ? (
        <HasTipButton
          className="primary"
          disabled={busy || nextDisabled}
          onClick={onNext}
          tip={nextTip}
        >
          Next
        </HasTipButton>
      ) : null}
    </>
  );
}
