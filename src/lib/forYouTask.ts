/** Keep the For You row on Approach until the operator taps Next. */

export function canPresentForYouTask(opts: {
  needsXLink: boolean;
  hasAgenda: boolean;
  grounded: boolean;
  cooldownRemaining: number;
}): boolean {
  return (
    !opts.needsXLink &&
    opts.hasAgenda &&
    !opts.grounded &&
    opts.cooldownRemaining <= 0
  );
}

export function shouldHoldForYouTask(opts: {
  held: boolean;
  tanksEmpty: boolean;
  canPresent: boolean;
}): boolean {
  if (!opts.canPresent) return false;
  if (opts.held) return true;
  return opts.tanksEmpty;
}
