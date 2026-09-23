/**
 * Browser-side Scout familiarity (C14): the allowlisted projection C13 serves
 * on `desk.scoutFamiliarity` (boot) and `GET /api/scout/profile` (refresh).
 *
 * Parsing copies exactly the frozen fields and drops everything else, so an
 * unknown or private key can never reach React state or the boot cache. A
 * missing/null/invalid value never invalidates the surrounding boot payload.
 * No gamification data lives here and none of this feeds XP.
 */
import type { ThreadKind } from "../desk/types";
import { isOneOf } from "./typeGuards";
import { apiFetch } from "./apiBase";

export type ScoutFamiliarityState = "empty" | "learning" | "supported";

export type ScoutFamiliarityBias = {
  kind: ThreadKind;
  bias: "prefer" | "avoid";
  takes: number;
  skips: number;
};

export type ScoutFamiliarityHint = {
  category: "topic" | "author";
  value: string;
  distinctTargets: number;
};

export type ScoutFamiliarity = {
  state: ScoutFamiliarityState;
  version: 1;
  revision: number;
  /** Coverage only, 0–100. Not accuracy, not XP. */
  score: number;
  coverage: { storedConfirmedReplies: number; knownKindResolvedActions: number };
  biases: ScoutFamiliarityBias[];
  hints: ScoutFamiliarityHint[];
  lastLearned: {
    at: string;
    action: "take" | "skip" | "dismiss";
    threadKind: ThreadKind | null;
  } | null;
  updatedAt: string | null;
};

export const SCOUT_PROFILE_PATH = "/api/scout/profile";

const MAX_BIASES = 3;
const MAX_HINTS = 3;
const MAX_HINT_VALUE_CHARS = 64;

const THREAD_KINDS: ReadonlySet<string> = new Set<ThreadKind>([
  "timely_take",
  "fact_add",
  "sharp_opinion",
  "lived_answer",
  "hollow_ask",
  "promo_context",
  "bare_news",
  "closed_thread",
  "other",
]);
const STATES = ["empty", "learning", "supported"] as const;
const ACTIONS = ["take", "skip", "dismiss"] as const;

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isKind(value: unknown): value is ThreadKind {
  return typeof value === "string" && THREAD_KINDS.has(value);
}

function parseBiases(raw: unknown): ScoutFamiliarityBias[] {
  if (!Array.isArray(raw)) return [];
  const out: ScoutFamiliarityBias[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const { kind, bias, takes, skips } = item;
    if (!isKind(kind) || (bias !== "prefer" && bias !== "avoid")) continue;
    if (!isCount(takes) || !isCount(skips) || seen.has(kind)) continue;
    seen.add(kind);
    out.push({ kind, bias, takes, skips });
    if (out.length === MAX_BIASES) break;
  }
  return out;
}

function parseHints(raw: unknown): ScoutFamiliarityHint[] {
  if (!Array.isArray(raw)) return [];
  const out: ScoutFamiliarityHint[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const { category, value, distinctTargets } = item;
    if (category !== "topic" && category !== "author") continue;
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > MAX_HINT_VALUE_CHARS ||
      value !== value.trim() ||
      !isCount(distinctTargets)
    ) {
      continue;
    }
    const key = `${category}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ category, value, distinctTargets });
    if (out.length === MAX_HINTS) break;
  }
  return out;
}

/**
 * Parse one projection. `null` for anything that is not a usable projection;
 * invalid list entries are dropped, and the lists are always empty outside
 * the supported state so an unsupported profile can never show a claim.
 */
export function parseScoutFamiliarity(raw: unknown): ScoutFamiliarity | null {
  if (!isRecord(raw)) return null;
  const { state, version, revision, score, coverage, updatedAt } = raw;
  if (!isOneOf(state, STATES)) return null;
  if (version !== 1 || !isCount(revision)) return null;
  if (!isCount(score) || score > 100) return null;
  if (!isRecord(coverage)) return null;
  const { storedConfirmedReplies, knownKindResolvedActions } = coverage;
  if (!isCount(storedConfirmedReplies) || !isCount(knownKindResolvedActions)) {
    return null;
  }
  if (!(updatedAt === null || isIso(updatedAt))) return null;

  let lastLearned: ScoutFamiliarity["lastLearned"] = null;
  if (raw.lastLearned !== null) {
    if (!isRecord(raw.lastLearned)) return null;
    const { at, action, threadKind } = raw.lastLearned;
    if (!isIso(at) || !isOneOf(action, ACTIONS)) return null;
    lastLearned = {
      at,
      action,
      threadKind: isKind(threadKind) ? threadKind : null,
    };
  }

  const supported = state === "supported";
  return {
    state,
    version: 1,
    revision,
    score,
    coverage: { storedConfirmedReplies, knownKindResolvedActions },
    biases: supported ? parseBiases(raw.biases) : [],
    hints: supported ? parseHints(raw.hints) : [],
    lastLearned,
    updatedAt,
  };
}

/**
 * Refresh the session user's projection. Any failure (network, 401/404/5xx,
 * unusable body) is `null`: unavailable, never a fabricated empty state.
 */
export async function fetchScoutFamiliarity(
  signal?: AbortSignal,
): Promise<ScoutFamiliarity | null> {
  try {
    const res = await apiFetch(SCOUT_PROFILE_PATH, signal ? { signal } : undefined);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!isRecord(data) || data.ok !== true) return null;
    return parseScoutFamiliarity(data.scoutFamiliarity);
  } catch {
    return null;
  }
}
