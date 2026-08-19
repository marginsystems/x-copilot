/** Official X OAuth only — a typed handle does not unlock the desk. */
export function deskNeedsXLink(
  user: { xLinked?: boolean } | null | undefined,
): boolean {
  return Boolean(user && user.xLinked !== true);
}

const OPEN_WITHOUT_X = new Set(["account", "usage", "admin"]);

/** Full-screen Link X CTA instead of Take off / threads. */
export function showDeskXGate(opts: {
  needsXLink: boolean;
  needsLogin: boolean;
  needsOnboarding: boolean;
  legalView: boolean;
  showLanding: boolean;
  view: string;
}): boolean {
  if (!opts.needsXLink) return false;
  if (
    opts.needsLogin ||
    opts.needsOnboarding ||
    opts.legalView ||
    opts.showLanding
  ) {
    return false;
  }
  return !OPEN_WITHOUT_X.has(opts.view);
}
