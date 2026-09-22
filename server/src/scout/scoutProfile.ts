/**
 * Deterministic ScoutProfile reducer (C10).
 *
 * Pure: turns a per-user snapshot of durable C09 observations into the frozen
 * public ScoutProfile. No SQL, files, clocks, providers or vector search here;
 * scoutProfileStore.ts owns persistence and evidence reads.
 *
 * The public module contract below is frozen by the Wave 1 brief. Do not add
 * fields for speculative consumers.
 */
import { THREAD_KINDS, type ThreadKind } from "./threadTriage.js";

export type ActionCounts = {
  takes: number;
  skips: number;
  dismissals: number;
};

export type ScoutKindProfile = ActionCounts & {
  resolvedActions: number; // takes + skips, after supersession
  smoothedTakeRate: number;
  bias: "learning" | "prefer" | "avoid" | "neutral";
};

export type ScoutSupportedHint = ActionCounts & {
  value: string; // normalized topic token or actual target author key
  distinctTargets: number;
};

export type ScoutProfile = {
  version: 1;
  userId: string;
  revision: number; // durable per-user evidence revision; 0 when empty
  updatedAt: string | null; // material evidence-change time, never read time
  counts: ActionCounts; // deduplicated raw observations, before skip supersession
  coverage: {
    storedConfirmedReplies: number;
    knownKindResolvedActions: number;
    unknownKindResolvedActions: number;
  };
  kinds: Record<ThreadKind, ScoutKindProfile>;
  overall: {
    takes: number;
    skips: number;
    resolvedActions: number;
    smoothedTakeRate: number;
  };
  topics: ScoutSupportedHint[];
  authors: ScoutSupportedHint[];
  familiarity: {
    state: "empty" | "learning" | "supported";
    score: number; // integer 0..100, coverage only
  };
  lastLearned: {
    at: string;
    action: "take" | "skip" | "dismiss";
    threadKind: ThreadKind | null;
  } | null;
};

export type ScoutProfileAction = "take" | "skip" | "dismiss";

/**
 * Reducer input: one deduplicated durable observation. The store maps C09
 * evidence rows onto this shape so the reducer never depends on SQL columns.
 */
export type ScoutProfileObservation = {
  /** Stable C09 identity (`reply:<id>`, `skip:scout:<cardId>`, ...). */
  eventKey: string;
  action: ScoutProfileAction;
  /** Original action time (ISO). */
  at: string;
  /** Material evidence-change time for this observation (ISO). */
  changedAt: string;
  /** Actual target identifier when known. */
  targetId: string | null;
  /** Card / parent / conversation aliases captured with the target. */
  targetAliases: string[];
  threadKind: ThreadKind | null;
  /** Normalized actual target author key, or null. */
  author: string | null;
  topics: string[];
  /** Confirmed reply id for takes. */
  replyId: string | null;
  /** Owned, nonempty confirmed-reply note verified for this reply. */
  storedReplyVerified: boolean;
};

export type ScoutProfileEvidenceSnapshot = {
  userId: string;
  revision: number;
  updatedAt: string | null;
  observations: ScoutProfileObservation[];
};

export const SCOUT_PROFILE_VERSION = 1 as const;
export const KIND_RATE_SUPPORT_FLOOR = 5;
export const OVERALL_RATE_SUPPORT_FLOOR = 10;
export const HINT_DISTINCT_TARGET_FLOOR = 3;
export const MAX_HINTS_PER_CATEGORY = 3;
export const FAMILIARITY_STORED_REPLIES_CAP = 20;
export const FAMILIARITY_KNOWN_ACTIONS_CAP = 20;

function emptyCounts(): ActionCounts {
  return { takes: 0, skips: 0, dismissals: 0 };
}

export function smoothedTakeRate(takes: number, skips: number): number {
  return (takes + 1) / (takes + skips + 2);
}

function emptyKindProfile(): ScoutKindProfile {
  return {
    ...emptyCounts(),
    resolvedActions: 0,
    smoothedTakeRate: smoothedTakeRate(0, 0),
    bias: "learning",
  };
}

function emptyKinds(): Record<ThreadKind, ScoutKindProfile> {
  return {
    timely_take: emptyKindProfile(),
    fact_add: emptyKindProfile(),
    sharp_opinion: emptyKindProfile(),
    lived_answer: emptyKindProfile(),
    hollow_ask: emptyKindProfile(),
    promo_context: emptyKindProfile(),
    bare_news: emptyKindProfile(),
    closed_thread: emptyKindProfile(),
    other: emptyKindProfile(),
  };
}

/** Frozen familiarity formula. Coverage only; not accuracy or affinity. */
export function familiarityScore(
  storedConfirmedReplies: number,
  knownKindResolvedActions: number,
): number {
  const stored = Math.min(
    1,
    Math.max(0, storedConfirmedReplies) / FAMILIARITY_STORED_REPLIES_CAP,
  );
  const known = Math.min(
    1,
    Math.max(0, knownKindResolvedActions) / FAMILIARITY_KNOWN_ACTIONS_CAP,
  );
  return Math.round(100 * stored * known);
}

export function emptyScoutProfile(userId: string): ScoutProfile {
  return {
    version: SCOUT_PROFILE_VERSION,
    userId,
    revision: 0,
    updatedAt: null,
    counts: emptyCounts(),
    coverage: {
      storedConfirmedReplies: 0,
      knownKindResolvedActions: 0,
      unknownKindResolvedActions: 0,
    },
    kinds: emptyKinds(),
    overall: {
      takes: 0,
      skips: 0,
      resolvedActions: 0,
      smoothedTakeRate: smoothedTakeRate(0, 0),
    },
    topics: [],
    authors: [],
    familiarity: { state: "empty", score: 0 },
    lastLearned: null,
  };
}

function isKnownKind(value: ThreadKind | null): value is ThreadKind {
  return value !== null && (THREAD_KINDS as readonly string[]).includes(value);
}

function timeMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/** Identity keys that name the same acted-on target. */
function targetKeys(obs: ScoutProfileObservation): string[] {
  const keys = new Set<string>();
  if (obs.targetId && obs.targetId.trim()) keys.add(obs.targetId.trim());
  for (const alias of obs.targetAliases) {
    if (typeof alias === "string" && alias.trim()) keys.add(alias.trim());
  }
  return [...keys];
}

/** Canonical distinct-target key: actual target, else the event itself. */
function distinctTargetKey(obs: ScoutProfileObservation): string {
  const id = obs.targetId?.trim();
  return id ? `t:${id}` : `e:${obs.eventKey}`;
}

/** Keep one observation per C09 identity; the earliest action time wins. */
function dedupeObservations(
  observations: ScoutProfileObservation[],
): ScoutProfileObservation[] {
  const byKey = new Map<string, ScoutProfileObservation>();
  for (const obs of observations) {
    const key = obs.eventKey.trim();
    if (!key) continue;
    const prior = byKey.get(key);
    if (!prior || timeMs(obs.at) < timeMs(prior.at)) {
      byKey.set(key, { ...obs, eventKey: key });
    }
  }
  return [...byKey.values()].sort(
    (a, b) => timeMs(a.at) - timeMs(b.at) || a.eventKey.localeCompare(b.eventKey),
  );
}

/**
 * A skip is superseded when the same user later confirmed a take on the same
 * target (matching any captured target/card alias). Dismissals never are.
 */
function supersededSkipKeys(
  observations: ScoutProfileObservation[],
): Set<string> {
  const latestTakeByTarget = new Map<string, number>();
  for (const obs of observations) {
    if (obs.action !== "take") continue;
    const at = timeMs(obs.at);
    for (const key of targetKeys(obs)) {
      const prior = latestTakeByTarget.get(key);
      if (prior === undefined || at > prior) latestTakeByTarget.set(key, at);
    }
  }
  const superseded = new Set<string>();
  if (!latestTakeByTarget.size) return superseded;
  for (const obs of observations) {
    if (obs.action !== "skip") continue;
    const skipAt = timeMs(obs.at);
    for (const key of targetKeys(obs)) {
      const takeAt = latestTakeByTarget.get(key);
      if (takeAt !== undefined && takeAt >= skipAt) {
        superseded.add(obs.eventKey);
        break;
      }
    }
  }
  return superseded;
}

type HintAccumulator = ActionCounts & { targets: Set<string> };

function accumulateHint(
  bucket: Map<string, HintAccumulator>,
  value: string,
  obs: ScoutProfileObservation,
  countAction: ScoutProfileAction,
): void {
  const key = value.trim();
  if (!key) return;
  let acc = bucket.get(key);
  if (!acc) {
    acc = { ...emptyCounts(), targets: new Set<string>() };
    bucket.set(key, acc);
  }
  acc.targets.add(distinctTargetKey(obs));
  if (countAction === "take") acc.takes += 1;
  else if (countAction === "skip") acc.skips += 1;
  else if (countAction === "dismiss") acc.dismissals += 1;
}

function finalizeHints(bucket: Map<string, HintAccumulator>): ScoutSupportedHint[] {
  const hints: ScoutSupportedHint[] = [];
  for (const [value, acc] of bucket) {
    if (acc.targets.size < HINT_DISTINCT_TARGET_FLOOR) continue;
    hints.push({
      value,
      takes: acc.takes,
      skips: acc.skips,
      dismissals: acc.dismissals,
      distinctTargets: acc.targets.size,
    });
  }
  hints.sort(
    (a, b) =>
      b.distinctTargets - a.distinctTargets || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
  );
  return hints.slice(0, MAX_HINTS_PER_CATEGORY);
}

function kindBias(
  kind: ScoutKindProfile,
  overall: ScoutProfile["overall"],
): ScoutKindProfile["bias"] {
  if (
    kind.resolvedActions < KIND_RATE_SUPPORT_FLOOR ||
    overall.resolvedActions < OVERALL_RATE_SUPPORT_FLOOR
  ) {
    return "learning";
  }
  if (kind.smoothedTakeRate > overall.smoothedTakeRate) return "prefer";
  if (kind.smoothedTakeRate < overall.smoothedTakeRate) return "avoid";
  return "neutral";
}

function pickLastLearned(
  observations: ScoutProfileObservation[],
): ScoutProfile["lastLearned"] {
  let best: ScoutProfileObservation | null = null;
  for (const obs of observations) {
    if (!Number.isFinite(timeMs(obs.changedAt))) continue;
    if (
      !best ||
      timeMs(obs.changedAt) > timeMs(best.changedAt) ||
      (timeMs(obs.changedAt) === timeMs(best.changedAt) &&
        obs.eventKey < best.eventKey)
    ) {
      best = obs;
    }
  }
  if (!best) return null;
  return {
    at: best.changedAt,
    action: best.action,
    threadKind: isKnownKind(best.threadKind) ? best.threadKind : null,
  };
}

/** Reduce a per-user evidence snapshot into the frozen ScoutProfile. */
export function reduceScoutProfile(
  snapshot: ScoutProfileEvidenceSnapshot,
): ScoutProfile {
  const userId = snapshot.userId.trim();
  if (!userId) throw new Error("reduceScoutProfile: blank userId");
  const observations = dedupeObservations(snapshot.observations);
  if (!observations.length) {
    return {
      ...emptyScoutProfile(userId),
      revision: Math.max(0, Math.floor(snapshot.revision)),
      updatedAt: snapshot.updatedAt,
    };
  }

  const profile = emptyScoutProfile(userId);
  profile.revision = Math.max(0, Math.floor(snapshot.revision));
  profile.updatedAt = snapshot.updatedAt;

  const superseded = supersededSkipKeys(observations);
  const storedReplies = new Set<string>();
  const topics = new Map<string, HintAccumulator>();
  const authors = new Map<string, HintAccumulator>();

  for (const obs of observations) {
    // Raw deduplicated counts keep explicit action distinctions.
    if (obs.action === "take") profile.counts.takes += 1;
    else if (obs.action === "skip") profile.counts.skips += 1;
    else profile.counts.dismissals += 1;

    if (obs.action === "take" && obs.storedReplyVerified && obs.replyId?.trim()) {
      storedReplies.add(obs.replyId.trim());
    }

    const resolvedAction: ScoutProfileAction | null =
      obs.action === "skip" && superseded.has(obs.eventKey) ? null : obs.action;
    const threadKind = obs.threadKind;
    const known = isKnownKind(threadKind);

    if (resolvedAction === "take" || resolvedAction === "skip") {
      if (known) {
        const kind = profile.kinds[threadKind];
        if (resolvedAction === "take") kind.takes += 1;
        else kind.skips += 1;
        kind.resolvedActions += 1;
        profile.coverage.knownKindResolvedActions += 1;
      } else {
        profile.coverage.unknownKindResolvedActions += 1;
      }
    } else if (resolvedAction === "dismiss" && known) {
      profile.kinds[threadKind].dismissals += 1;
    }

    // A superseded skip's target is already acted on through its take.
    if (resolvedAction === null) continue;
    for (const topic of new Set(obs.topics)) {
      accumulateHint(topics, topic, obs, resolvedAction);
    }
    if (obs.author) accumulateHint(authors, obs.author, obs, resolvedAction);
  }

  for (const kind of THREAD_KINDS) {
    const entry = profile.kinds[kind];
    entry.smoothedTakeRate = smoothedTakeRate(entry.takes, entry.skips);
    profile.overall.takes += entry.takes;
    profile.overall.skips += entry.skips;
  }
  profile.overall.resolvedActions = profile.overall.takes + profile.overall.skips;
  profile.overall.smoothedTakeRate = smoothedTakeRate(
    profile.overall.takes,
    profile.overall.skips,
  );
  for (const kind of THREAD_KINDS) {
    profile.kinds[kind].bias = kindBias(profile.kinds[kind], profile.overall);
  }

  profile.topics = finalizeHints(topics);
  profile.authors = finalizeHints(authors);

  profile.coverage.storedConfirmedReplies = storedReplies.size;
  profile.familiarity.score = familiarityScore(
    profile.coverage.storedConfirmedReplies,
    profile.coverage.knownKindResolvedActions,
  );
  if (profile.coverage.storedConfirmedReplies === 0) {
    profile.familiarity.state = "empty";
  } else {
    const supportedKind = THREAD_KINDS.some(
      (kind) => profile.kinds[kind].bias !== "learning",
    );
    profile.familiarity.state =
      supportedKind || profile.topics.length > 0 || profile.authors.length > 0
        ? "supported"
        : "learning";
  }

  profile.lastLearned = pickLastLearned(observations);
  return profile;
}
