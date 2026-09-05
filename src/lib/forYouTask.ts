/** Keep the For You row on Approach until the operator taps Next. */

export const FOR_YOU_WAIT_STORAGE_KEY = "x-copilot-fyp-wait";

export type ForYouWaitSnapshot = {
  postsToday: number;
  postAt: string | null;
  replyAt: string | null;
};

export type ForYouWait = {
  held: true;
  snapshot: ForYouWaitSnapshot | null;
};

type CoachingActivity = {
  postsToday?: number;
  postAt?: string[];
  replyAt?: string[];
};

export function snapshotForYouWait(
  coaching?: CoachingActivity | null,
): ForYouWaitSnapshot | null {
  if (!coaching) return null;
  return {
    postsToday: coaching.postsToday ?? 0,
    postAt: coaching.postAt?.[0] ?? null,
    replyAt: coaching.replyAt?.[0] ?? null,
  };
}

export function readForYouWait(): ForYouWait | null {
  try {
    const parsed: unknown = JSON.parse(
      sessionStorage.getItem(FOR_YOU_WAIT_STORAGE_KEY) ?? "null",
    );
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as { held?: unknown; snapshot?: unknown };
    if (row.held !== true) return null;
    if (row.snapshot === null) return { held: true, snapshot: null };
    if (!row.snapshot || typeof row.snapshot !== "object") return null;
    const snapshot = row.snapshot as Record<string, unknown>;
    if (
      typeof snapshot.postsToday !== "number" ||
      (snapshot.postAt !== null && typeof snapshot.postAt !== "string") ||
      (snapshot.replyAt !== null && typeof snapshot.replyAt !== "string")
    ) {
      return null;
    }
    return {
      held: true,
      snapshot: {
        postsToday: snapshot.postsToday,
        postAt: snapshot.postAt as string | null,
        replyAt: snapshot.replyAt as string | null,
      },
    };
  } catch {
    return null;
  }
}

export function writeForYouWait(wait: ForYouWait): void {
  try {
    sessionStorage.setItem(FOR_YOU_WAIT_STORAGE_KEY, JSON.stringify(wait));
  } catch {
    /* private mode */
  }
}

export function clearForYouWait(): void {
  try {
    sessionStorage.removeItem(FOR_YOU_WAIT_STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

export function hasDetectedForYouPost(
  snapshot: ForYouWaitSnapshot,
  coaching?: CoachingActivity | null,
): boolean {
  if (!coaching) return false;
  if ((coaching.postsToday ?? 0) > snapshot.postsToday) return true;
  const newer = (latest: string | undefined, baseline: string | null) =>
    Boolean(latest && (!baseline || Date.parse(latest) > Date.parse(baseline)));
  return (
    newer(coaching.postAt?.[0], snapshot.postAt) ||
    newer(coaching.replyAt?.[0], snapshot.replyAt)
  );
}

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
  /** False after skip / not interested on a scouted card. That is not the wait. */
  arm?: boolean;
}): boolean {
  if (opts.held) return true;
  if (opts.arm === false) return false;
  if (!opts.canPresent) return false;
  return opts.tanksEmpty;
}
