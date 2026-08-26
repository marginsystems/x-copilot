/** Client types + fetch for GET /api/coaching. */

import { apiFetch } from "./apiBase";

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
  };
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
