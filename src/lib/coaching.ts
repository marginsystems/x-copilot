/** Client types + fetch for GET /api/coaching. */

import { apiFetch } from "./apiBase";
import { emptyDeskBeats, type DeskBeats } from "./deskPhase";

export const NEXT_ACTION_KINDS = [
  "reply",
  "original",
  "takeoff",
  "quote",
  "repost",
  "for_you",
  "streak",
] as const;
export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number];

export type NextActionCard = {
  kind: NextActionKind;
  text: string;
  updatedAt: string;
};

export type DailyMission = {
  id: string;
  label: string;
  target: number;
  progress: number;
  xpReward: number;
  completed: boolean;
  claimed: boolean;
};

export type OwnActivity = {
  id: string;
  url: string;
  text: string;
  kind: "reply" | "original" | "quote";
  postedAt: string;
};

export type CoachingState = {
  dayUtc: string;
  nextAction: NextActionCard | null;
  missions: DailyMission[];
  beats: DeskBeats;
  /** own_posts originals + quotes today. Missing on older boot caches. */
  postsToday?: number;
  /** own_posts originals today (not quotes). */
  originalsToday?: number;
  /** Last 500 reply times on the desk, newest first. */
  replyAt?: string[];
  /** Last 500 original posted_at values. */
  originalAt?: string[];
  /** Last 500 original + quote posted_at values. */
  postAt?: string[];
  /** Newest reply, original, or quote from the existing own_posts watch. */
  ownActivity?: OwnActivity | null;
};

export type CoachingFetchOptions = { lite?: boolean };

const KINDS = new Set<string>(NEXT_ACTION_KINDS);

function finiteNonNeg(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export function parseNextAction(raw: unknown): NextActionCard | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.kind !== "string" || !KINDS.has(row.kind)) return null;
  const text = typeof row.text === "string" ? row.text.trim() : "";
  if (!text) return null;
  return {
    kind: row.kind as NextActionKind,
    text,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
  };
}

export function parseDailyMission(raw: unknown): DailyMission | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const label = typeof row.label === "string" ? row.label.trim() : "";
  const target = finiteNonNeg(row.target);
  const progress = finiteNonNeg(row.progress);
  const xpReward = finiteNonNeg(row.xpReward);
  if (!id || !label || target === null || progress === null || xpReward === null) {
    return null;
  }
  return {
    id,
    label,
    target,
    progress,
    xpReward,
    completed: row.completed === true,
    claimed: row.claimed === true,
  };
}

function parseOwnActivity(raw: unknown): OwnActivity | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.url !== "string" ||
    typeof row.text !== "string" ||
    typeof row.postedAt !== "string" ||
    (row.kind !== "reply" && row.kind !== "original" && row.kind !== "quote")
  ) {
    return null;
  }
  return {
    id: row.id,
    url: row.url,
    text: row.text,
    kind: row.kind,
    postedAt: row.postedAt,
  };
}

export function parseDeskBeats(raw: unknown): DeskBeats {
  if (!raw || typeof raw !== "object") return emptyDeskBeats();
  const row = raw as Record<string, unknown>;
  const forkChoice =
    row.forkChoice === "original" || row.forkChoice === "reply"
      ? row.forkChoice
      : row.forkChoice === null
        ? null
        : undefined;
  if (
    typeof row.scoutReplyDone !== "boolean" ||
    typeof row.organicReplyDone !== "boolean" ||
    typeof row.forkDone !== "boolean" ||
    forkChoice === undefined
  ) {
    return emptyDeskBeats();
  }
  return {
    scoutReplyDone: row.scoutReplyDone,
    organicReplyDone: row.organicReplyDone,
    forkChoice,
    forkDone: row.forkDone,
  };
}

export function parseCoachingPayload(raw: unknown): CoachingState | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const dayUtc = typeof row.dayUtc === "string" ? row.dayUtc : "";
  const missions = Array.isArray(row.missions)
    ? row.missions
        .map(parseDailyMission)
        .filter((m): m is DailyMission => Boolean(m))
    : [];
  return {
    dayUtc,
    nextAction: parseNextAction(row.nextAction),
    missions,
    beats: parseDeskBeats(row.beats),
    postsToday: finiteNonNeg(row.postsToday) ?? 0,
    originalsToday: finiteNonNeg(row.originalsToday) ?? 0,
    replyAt: parseIsoList(row.replyAt),
    originalAt: parseIsoList(row.originalAt),
    postAt: parseIsoList(row.postAt),
    ownActivity: parseOwnActivity(row.ownActivity),
  };
}

function parseIsoList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is string => typeof row === "string" && row.length > 0)
    .slice(0, 2000);
}

export function mergeCoachingState(
  current: CoachingState | null,
  next: CoachingState,
  opts?: CoachingFetchOptions,
): CoachingState {
  if (!opts?.lite || !current) return next;
  const foldNewest = (currentValues: string[] | undefined, nextValues: string[]) =>
    [...nextValues, ...(currentValues ?? [])]
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 2000);
  return {
    ...current,
    ...next,
    nextAction: current.nextAction,
    missions: current.missions,
    originalAt: current.originalAt,
    replyAt: foldNewest(current.replyAt, next.replyAt ?? []),
    postAt: foldNewest(current.postAt, next.postAt ?? []),
  };
}

export async function fetchCoaching(
  opts?: CoachingFetchOptions,
): Promise<CoachingState | null> {
  try {
    const res = await apiFetch(`/api/coaching${opts?.lite ? "?lite=1" : ""}`);
    if (!res.ok) return null;
    return parseCoachingPayload(await res.json());
  } catch {
    return null;
  }
}
