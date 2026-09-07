/**
 * The For You wait belongs to one presented task. It records who owns it, when
 * the card was entered, the activity baseline, and a monotonic completion mark.
 * Detection marks; only Next (or Bypass) releases.
 */

export const FOR_YOU_WAIT_STORAGE_KEY = "x-copilot-fyp-wait";

export type ForYouWaitSnapshot = {
  postsToday: number;
  postAt: string | null;
  replyAt: string | null;
};

export type ForYouWait = {
  held: true;
  kind: "for_you";
  /** User the wait belongs to. A wait never runs behind another operator's card. */
  owner: string;
  /** When the task was presented. The explicit baseline when coaching was not loaded yet. */
  enteredAt: string;
  /** Coaching activity at entry, or the first payload that did not post-date entry. */
  snapshot: ForYouWaitSnapshot | null;
  /** Set once. Later coaching merges cannot un-detect the task. */
  detectedAt: string | null;
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

/** A fresh wait for a task that was just presented. */
export function openForYouWait(opts: {
  owner: string;
  coaching?: CoachingActivity | null;
  now?: number;
}): ForYouWait {
  return {
    held: true,
    kind: "for_you",
    owner: opts.owner,
    enteredAt: new Date(opts.now ?? Date.now()).toISOString(),
    snapshot: snapshotForYouWait(opts.coaching),
    detectedAt: null,
  };
}

function newerThan(latest: string | undefined, baseline: string | null): boolean {
  return Boolean(
    latest && (!baseline || Date.parse(latest) > Date.parse(baseline)),
  );
}

/** A reply, original, or quote after the entry time. Likes never appear here. */
function activitySince(
  enteredAt: string,
  coaching: CoachingActivity,
): boolean {
  return (
    newerThan(coaching.postAt?.[0], enteredAt) ||
    newerThan(coaching.replyAt?.[0], enteredAt)
  );
}

export function hasDetectedForYouPost(
  snapshot: ForYouWaitSnapshot,
  coaching?: CoachingActivity | null,
): boolean {
  if (!coaching) return false;
  if ((coaching.postsToday ?? 0) > snapshot.postsToday) return true;
  return (
    newerThan(coaching.postAt?.[0], snapshot.postAt) ||
    newerThan(coaching.replyAt?.[0], snapshot.replyAt)
  );
}

export function forYouWaitDetected(
  wait: ForYouWait,
  coaching?: CoachingActivity | null,
): boolean {
  if (wait.detectedAt) return true;
  if (!coaching) return false;
  if (wait.snapshot) return hasDetectedForYouPost(wait.snapshot, coaching);
  return activitySince(wait.enteredAt, coaching);
}

/**
 * Fold one coaching payload into the wait. A late payload becomes the baseline
 * only when it carries nothing newer than the entry time; otherwise the task is
 * marked detected. Returns the same object when nothing changes.
 */
export function settleForYouWait(
  wait: ForYouWait,
  coaching?: CoachingActivity | null,
  now: number = Date.now(),
): ForYouWait {
  if (wait.detectedAt || !coaching) return wait;
  const detectedAt = new Date(now).toISOString();
  if (!wait.snapshot) {
    const snapshot = snapshotForYouWait(coaching);
    return activitySince(wait.enteredAt, coaching)
      ? { ...wait, snapshot, detectedAt }
      : { ...wait, snapshot };
  }
  if (hasDetectedForYouPost(wait.snapshot, coaching)) {
    return { ...wait, detectedAt };
  }
  return wait;
}

function storageKey(owner: string): string {
  return `${FOR_YOU_WAIT_STORAGE_KEY}:${owner}`;
}

function parseSnapshot(raw: unknown): ForYouWaitSnapshot | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const snapshot = raw as Record<string, unknown>;
  if (
    typeof snapshot.postsToday !== "number" ||
    (snapshot.postAt !== null && typeof snapshot.postAt !== "string") ||
    (snapshot.replyAt !== null && typeof snapshot.replyAt !== "string")
  ) {
    return undefined;
  }
  return {
    postsToday: snapshot.postsToday,
    postAt: snapshot.postAt as string | null,
    replyAt: snapshot.replyAt as string | null,
  };
}

export function parseForYouWait(
  raw: string | null,
  owner: string,
): ForYouWait | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Record<string, unknown>;
    if (row.held !== true || row.kind !== "for_you") return null;
    if (row.owner !== owner) return null;
    if (typeof row.enteredAt !== "string") return null;
    if (row.detectedAt !== null && typeof row.detectedAt !== "string") {
      return null;
    }
    const snapshot = parseSnapshot(row.snapshot);
    if (snapshot === undefined) return null;
    return {
      held: true,
      kind: "for_you",
      owner,
      enteredAt: row.enteredAt,
      snapshot,
      detectedAt: row.detectedAt as string | null,
    };
  } catch {
    return null;
  }
}

export function readForYouWait(owner: string): ForYouWait | null {
  try {
    return parseForYouWait(sessionStorage.getItem(storageKey(owner)), owner);
  } catch {
    return null;
  }
}

export function writeForYouWait(wait: ForYouWait): void {
  try {
    sessionStorage.setItem(storageKey(wait.owner), JSON.stringify(wait));
  } catch {
    /* private mode */
  }
}

export function clearForYouWait(owner: string): void {
  try {
    sessionStorage.removeItem(storageKey(owner));
  } catch {
    /* private mode */
  }
}

/**
 * The free external task: read x.com/home and post. It needs a linked account
 * so detection can read own posts, and an agenda so the desk is set up. Scout
 * cooldown, grounding, and credits gate Scout, not this task.
 */
export function canOpenForYouTask(opts: {
  needsXLink: boolean;
  hasAgenda: boolean;
}): boolean {
  return !opts.needsXLink && opts.hasAgenda;
}
