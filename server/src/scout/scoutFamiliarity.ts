/**
 * Public Scout familiarity projection (C13).
 *
 * Turns one owned C10 ScoutProfile into the bounded browser-facing shape
 * shared by `GET /api/boot` and `GET /api/scout/profile`. Pure and
 * allowlisted: fields are copied explicitly, never spread, so no user id,
 * raw notes, observation identities, rates, dismissal counts or unknown
 * keys can reach a response. State and score come from the producer; this
 * module only re-enforces the existing C10 support floors when selecting
 * the bounded bias/hint lists and never computes a new preference.
 *
 * `loadScoutFamiliarity` is the one soft-failing loader both HTTP consumers
 * use: blank identity performs no read; a thrown error, absent result,
 * foreign owner or unusable core data all yield null. The store's own
 * fail-closed contract is unchanged.
 */
import type { ScoutProfile } from "./scoutProfile.js";
import { readScoutProfile } from "./scoutProfileStore.js";
import { THREAD_KINDS, type ThreadKind } from "./threadTriage.js";

export type ScoutFamiliarityState = "empty" | "learning" | "supported";
export type ScoutFamiliarityAction = "take" | "skip" | "dismiss";

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

/** Frozen public projection. No additional fields. */
export type ScoutFamiliarityProjection = {
  state: ScoutFamiliarityState;
  version: 1;
  revision: number;
  /** familiarity.score, coverage only */
  score: number;
  coverage: { storedConfirmedReplies: number; knownKindResolvedActions: number };
  /** max 3, supported state only */
  biases: ScoutFamiliarityBias[];
  /** max 3 total, supported state only */
  hints: ScoutFamiliarityHint[];
  lastLearned: {
    at: string;
    action: ScoutFamiliarityAction;
    threadKind: string | null;
  } | null;
  updatedAt: string | null;
};

/** Narrow injectable loader (tests). Production uses `readScoutProfile`. */
export type ScoutFamiliarityLoader = (
  userId: string,
) => Promise<ScoutProfile | null | undefined> | ScoutProfile | null | undefined;

/** Re-enforced C10 support floors and caps (see scoutProfile.ts). */
export const FAMILIARITY_KIND_SUPPORT_FLOOR = 5;
export const FAMILIARITY_OVERALL_SUPPORT_FLOOR = 10;
export const FAMILIARITY_HINT_DISTINCT_TARGET_FLOOR = 3;
export const MAX_FAMILIARITY_BIASES = 3;
export const MAX_FAMILIARITY_HINTS = 3;

/** Producer-compatible topic token: 3–32 chars, Unicode word with a letter. */
const TOPIC_MIN_CHARS = 3;
const TOPIC_MAX_CHARS = 32;
const TOPIC_TOKEN_RE = /^[\p{L}\p{N}][\p{L}\p{N}'’_-]*[\p{L}\p{N}]$/u;
/** Producer-compatible actual-author key (normalizeEvidenceAuthor). */
const AUTHOR_KEY_RE = /^[a-z0-9_]{1,15}$/;

const STATES: ReadonlySet<string> = new Set(["empty", "learning", "supported"]);
const ACTIONS: ReadonlySet<string> = new Set(["take", "skip", "dismiss"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isKnownKind(value: unknown): value is ThreadKind {
  return typeof value === "string" && (THREAD_KINDS as readonly string[]).includes(value);
}

function isTopicValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= TOPIC_MIN_CHARS &&
    value.length <= TOPIC_MAX_CHARS &&
    TOPIC_TOKEN_RE.test(value) &&
    /\p{L}/u.test(value)
  );
}

function isAuthorValue(value: unknown): value is string {
  return typeof value === "string" && AUTHOR_KEY_RE.test(value);
}

function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Supported prefer/avoid kinds meeting the existing floors, bounded to three. */
function selectBiases(kinds: unknown, overall: unknown): ScoutFamiliarityBias[] {
  if (!isRecord(kinds) || !isRecord(overall)) return [];
  const overallResolved = overall.resolvedActions;
  if (!isCount(overallResolved) || overallResolved < FAMILIARITY_OVERALL_SUPPORT_FLOOR) {
    return [];
  }
  const out: ScoutFamiliarityBias[] = [];
  for (const kind of THREAD_KINDS) {
    const entry = kinds[kind];
    if (!isRecord(entry)) continue;
    const { bias, takes, skips, resolvedActions } = entry;
    if (bias !== "prefer" && bias !== "avoid") continue;
    if (
      !isCount(takes) ||
      !isCount(skips) ||
      !isCount(resolvedActions) ||
      resolvedActions !== takes + skips ||
      resolvedActions < FAMILIARITY_KIND_SUPPORT_FLOOR
    ) {
      continue;
    }
    out.push({ kind, bias, takes, skips });
  }
  out.sort(
    (a, b) =>
      b.takes + b.skips - (a.takes + a.skips) || compareCodePoints(a.kind, b.kind),
  );
  return out.slice(0, MAX_FAMILIARITY_BIASES);
}

function collectHints(
  list: unknown,
  category: ScoutFamiliarityHint["category"],
  isValue: (value: unknown) => value is string,
  out: ScoutFamiliarityHint[],
  seen: Set<string>,
): void {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!isRecord(item)) continue;
    const { value, distinctTargets } = item;
    if (
      !isValue(value) ||
      !isCount(distinctTargets) ||
      distinctTargets < FAMILIARITY_HINT_DISTINCT_TARGET_FLOOR
    ) {
      continue;
    }
    const key = `${category}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ category, value, distinctTargets });
  }
}

/** Supported topic/author hints combined, bounded to three total. */
function selectHints(topics: unknown, authors: unknown): ScoutFamiliarityHint[] {
  const out: ScoutFamiliarityHint[] = [];
  const seen = new Set<string>();
  collectHints(topics, "topic", isTopicValue, out, seen);
  collectHints(authors, "author", isAuthorValue, out, seen);
  out.sort(
    (a, b) =>
      b.distinctTargets - a.distinctTargets ||
      compareCodePoints(a.category, b.category) ||
      compareCodePoints(a.value, b.value),
  );
  return out.slice(0, MAX_FAMILIARITY_HINTS);
}

function selectLastLearned(
  value: unknown,
): ScoutFamiliarityProjection["lastLearned"] | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { at, action, threadKind } = value;
  if (!isIso(at) || typeof action !== "string" || !ACTIONS.has(action)) {
    return undefined;
  }
  return {
    at,
    action: action as ScoutFamiliarityAction,
    // Only the closed kind enum is displayed; anything else reads as unknown.
    threadKind: isKnownKind(threadKind) ? threadKind : null,
  };
}

/**
 * Project a loaded profile for exactly `userId`, or null when the value is
 * not a usable profile owned by that user. Producer state/score/coverage are
 * copied, never derived; bounded lists are emitted only for `supported`.
 */
export function projectScoutFamiliarity(
  profile: unknown,
  userId: string,
): ScoutFamiliarityProjection | null {
  const id = userId.trim();
  if (!id) return null;
  if (!isRecord(profile)) return null;
  if (profile.version !== 1) return null;
  if (typeof profile.userId !== "string" || profile.userId !== id) return null;
  const { revision, updatedAt, coverage, familiarity } = profile;
  if (!isCount(revision)) return null;
  if (!(updatedAt === null || isIso(updatedAt))) return null;
  if (!isRecord(coverage) || !isRecord(familiarity)) return null;
  const { storedConfirmedReplies, knownKindResolvedActions } = coverage;
  if (!isCount(storedConfirmedReplies) || !isCount(knownKindResolvedActions)) {
    return null;
  }
  const { state, score } = familiarity;
  if (typeof state !== "string" || !STATES.has(state)) return null;
  if (!isCount(score) || score > 100) return null;
  const lastLearned = selectLastLearned(profile.lastLearned);
  if (lastLearned === undefined) return null;

  const supported = state === "supported";
  return {
    state: state as ScoutFamiliarityState,
    version: 1,
    revision,
    score,
    coverage: { storedConfirmedReplies, knownKindResolvedActions },
    biases: supported ? selectBiases(profile.kinds, profile.overall) : [],
    hints: supported ? selectHints(profile.topics, profile.authors) : [],
    lastLearned,
    updatedAt,
  };
}

/**
 * Load the session user's familiarity projection, or null. One owner-checked
 * store read per call; no retry, fallback owner, or fabricated profile.
 */
export async function loadScoutFamiliarity(
  userId: string | undefined,
  load: ScoutFamiliarityLoader = readScoutProfile,
): Promise<ScoutFamiliarityProjection | null> {
  const id = typeof userId === "string" ? userId.trim() : "";
  if (!id) return null;
  let loaded: unknown;
  try {
    loaded = await load(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[scout] familiarity unavailable: ${message}`);
    return null;
  }
  return projectScoutFamiliarity(loaded, id);
}
