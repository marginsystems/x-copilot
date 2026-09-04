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
};

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
  };
}

function parseIsoList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is string => typeof row === "string" && row.length > 0)
    .slice(0, 2000);
}

export async function fetchCoaching(): Promise<CoachingState | null> {
  try {
    const res = await apiFetch("/api/coaching");
    if (!res.ok) return null;
    return parseCoachingPayload(await res.json());
  } catch {
    return null;
  }
}

export async function postDeskForkChoice(
  forkChoice: "original" | "reply",
): Promise<DeskBeats | null> {
  try {
    const res = await apiFetch("/api/desk/beats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forkChoice }),
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const beats =
      json && typeof json === "object" && "beats" in json
        ? (json as { beats: unknown }).beats
        : null;
    const parsed = parseDeskBeats(beats);
    return parsed.forkChoice === forkChoice ? parsed : null;
  } catch {
    return null;
  }
}

export async function postDeskOriginalPosted(): Promise<DeskBeats | null> {
  try {
    const res = await apiFetch("/api/desk/beats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ originalPosted: true }),
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return parseDeskBeats(
      json && typeof json === "object" && "beats" in json
        ? (json as { beats: unknown }).beats
        : null,
    );
  } catch {
    return null;
  }
}

export function nextActionKindLabel(kind: NextActionKind): string {
  if (kind === "reply") return "Reply";
  if (kind === "original") return "Original";
  if (kind === "takeoff") return "Take off";
  if (kind === "quote") return "Quote";
  if (kind === "repost") return "Repost";
  if (kind === "for_you") return "Suggested";
  return "Streak";
}

export function nextActionKindShort(kind: NextActionKind): string {
  if (kind === "reply") return "R";
  if (kind === "original") return "OG";
  if (kind === "takeoff") return "TO";
  if (kind === "quote") return "Q";
  if (kind === "repost") return "RP";
  if (kind === "for_you") return "FY";
  return "★";
}

export function nextActionKindClass(kind: NextActionKind): string {
  if (kind === "quote") return "kind-quote";
  if (kind === "repost") return "kind-repost";
  if (kind === "reply" || kind === "streak") return "kind-reply";
  return "kind-post";
}

/** Next-action kinds that share a daily mission. Not LLM prose. */
const NEXT_ACTION_PROGRESS_MISSION: Partial<Record<NextActionKind, string>> = {
  reply: "mark_2",
  streak: "mark_2",
  original: "original_1",
};

export function missionFillPct(progress: number, target: number): number {
  if (target <= 0) return 0;
  return Math.round((Math.min(progress, target) / target) * 100);
}

export type NextActionProgress = {
  current: number;
  target: number;
  label: string;
};

export function nextActionProgress(
  action: NextActionCard | null,
  missions: readonly DailyMission[],
): NextActionProgress | null {
  if (!action) return null;
  const missionId = NEXT_ACTION_PROGRESS_MISSION[action.kind];
  if (!missionId) return null;
  const mission = missions.find((row) => row.id === missionId);
  if (!mission || mission.target <= 0) return null;
  const current = Math.min(mission.progress, mission.target);
  return {
    current,
    target: mission.target,
    label: `${current}/${mission.target}`,
  };
}
