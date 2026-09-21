/**
 * Per-user ScoutProfile persistence (C10).
 *
 * `data/scout-profile/u<sha256(userId)>.json` beside (never inside) the
 * gamification ledger. The profile is a projection rebuilt from durable C09
 * evidence — never incremented from HTTP requests. Rebuilds take the
 * per-user file lock shared across server/sidecar processes, read evidence in
 * one SQLite snapshot, and publish by same-directory temp file + rename. The
 * stored revision is compared with the durable evidence revision on read, so
 * stale, missing or corrupt projections are repaired from local evidence
 * only: no vector search, X or model calls.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getPlatformDb } from "../db.js";
import { ownerHash } from "../memory/ownedMemoryNotes.js";
import { withFileLock } from "../platform/fileLock.js";
import {
  listScoutEvidence,
  readScoutEvidenceRevision,
  requireEvidenceUserId,
  type ScoutEvidenceRow,
} from "./scoutEvidence.js";
import { reconcileScoutEvidence } from "./scoutEvidenceReconcile.js";
import {
  SCOUT_PROFILE_VERSION,
  reduceScoutProfile,
  type ActionCounts,
  type ScoutKindProfile,
  type ScoutProfile,
  type ScoutProfileEvidenceSnapshot,
  type ScoutProfileObservation,
  type ScoutSupportedHint,
} from "./scoutProfile.js";
import {
  setScoutProfileRebuild,
  withoutScoutProfileProjectionNotifications,
} from "./scoutProfileProjection.js";
import { THREAD_KINDS, type ThreadKind } from "./threadTriage.js";

export type { ScoutProfile } from "./scoutProfile.js";

export type ScoutProfileStoreOpts = {
  /** Override `data/scout-profile` (tests). */
  profileDir?: string;
  /** Knowledge root for bootstrap reconciliation (tests). */
  knowledgeRoot?: string;
  /**
   * Bootstrap repair when no valid projection exists yet: run the bounded
   * C09 reconciliation pass so legacy durable facts become evidence before
   * the first build. `false` skips it; a function replaces it (tests).
   */
  reconcile?: boolean | ((userId: string) => Promise<unknown>);
};

const REBUILD_ATTEMPTS = 5;

export function defaultScoutProfileDir(): string {
  const fromEnv = process.env.SCOUT_PROFILE_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(process.cwd(), "data", "scout-profile");
}

/** Safe owner key: the full SHA-256 owner component C07 uses for notes. */
export function scoutProfilePathForUser(
  userId: string,
  profileDir: string = defaultScoutProfileDir(),
): string {
  const id = requireEvidenceUserId(userId);
  return resolve(profileDir, `u${ownerHash(id)}.json`);
}

/** Map one durable evidence row onto the reducer's observation shape. */
export function evidenceRowToObservation(
  row: ScoutEvidenceRow,
): ScoutProfileObservation {
  const aliases: string[] = [];
  if (row.cardId && row.cardId !== row.targetId) aliases.push(row.cardId);
  return {
    eventKey: row.eventKey,
    action: row.action,
    at: row.actedAt,
    changedAt: row.updatedAt,
    targetId: row.targetId,
    targetAliases: aliases,
    threadKind: row.threadKind,
    author: row.targetAuthor,
    topics: row.topics,
    replyId: row.replyId,
    storedReplyVerified: row.action === "take" && row.noteState === "stored",
  };
}

/** Consistent per-user evidence snapshot (one SQLite read transaction). */
export function readScoutEvidenceSnapshot(
  userId: string,
): ScoutProfileEvidenceSnapshot {
  const id = requireEvidenceUserId(userId);
  const db = getPlatformDb();
  return db.transaction((): ScoutProfileEvidenceSnapshot => {
    const revision = readScoutEvidenceRevision(id);
    const rows = listScoutEvidence({ userId: id });
    return {
      userId: id,
      revision: revision.revision,
      updatedAt: revision.updatedAt,
      observations: rows.map(evidenceRowToObservation),
    };
  })();
}

// ---------------------------------------------------------------- validation

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return value;
  return undefined;
}

function parseCounts(value: unknown): ActionCounts | null {
  if (!isRecord(value)) return null;
  const takes = nonNegativeInt(value.takes);
  const skips = nonNegativeInt(value.skips);
  const dismissals = nonNegativeInt(value.dismissals);
  if (takes === null || skips === null || dismissals === null) return null;
  return { takes, skips, dismissals };
}

const BIASES: ReadonlySet<string> = new Set(["learning", "prefer", "avoid", "neutral"]);
const FAMILIARITY_STATES: ReadonlySet<string> = new Set(["empty", "learning", "supported"]);
const ACTIONS: ReadonlySet<string> = new Set(["take", "skip", "dismiss"]);

function parseKind(value: unknown): ScoutKindProfile | null {
  const counts = parseCounts(value);
  if (!counts || !isRecord(value)) return null;
  const resolvedActions = nonNegativeInt(value.resolvedActions);
  const smoothedTakeRate = finiteNumber(value.smoothedTakeRate);
  if (
    resolvedActions === null ||
    smoothedTakeRate === null ||
    typeof value.bias !== "string" ||
    !BIASES.has(value.bias)
  ) {
    return null;
  }
  return {
    ...counts,
    resolvedActions,
    smoothedTakeRate,
    bias: value.bias as ScoutKindProfile["bias"],
  };
}

function parseHints(value: unknown): ScoutSupportedHint[] | null {
  if (!Array.isArray(value)) return null;
  const out: ScoutSupportedHint[] = [];
  for (const item of value) {
    const counts = parseCounts(item);
    if (!counts || !isRecord(item)) return null;
    const distinctTargets = nonNegativeInt(item.distinctTargets);
    if (distinctTargets === null || typeof item.value !== "string") return null;
    out.push({ ...counts, value: item.value, distinctTargets });
  }
  return out;
}

/**
 * Validate a stored projection for this owner. Anything malformed, foreign,
 * or from another version is `null` so the caller rebuilds instead of
 * trusting it. Unknown keys are dropped; the result is the frozen shape.
 */
export function parseStoredScoutProfile(
  raw: string,
  userId: string,
): ScoutProfile | null {
  const id = requireEvidenceUserId(userId);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  if (data.version !== SCOUT_PROFILE_VERSION || data.userId !== id) return null;
  const revision = nonNegativeInt(data.revision);
  const updatedAt = isoOrNull(data.updatedAt);
  const counts = parseCounts(data.counts);
  if (revision === null || updatedAt === undefined || !counts) return null;

  if (!isRecord(data.coverage)) return null;
  const storedConfirmedReplies = nonNegativeInt(data.coverage.storedConfirmedReplies);
  const knownKindResolvedActions = nonNegativeInt(data.coverage.knownKindResolvedActions);
  const unknownKindResolvedActions = nonNegativeInt(
    data.coverage.unknownKindResolvedActions,
  );
  if (
    storedConfirmedReplies === null ||
    knownKindResolvedActions === null ||
    unknownKindResolvedActions === null
  ) {
    return null;
  }

  if (!isRecord(data.kinds)) return null;
  const kinds = {} as Record<ThreadKind, ScoutKindProfile>;
  for (const kind of THREAD_KINDS) {
    const parsed = parseKind(data.kinds[kind]);
    if (!parsed) return null;
    kinds[kind] = parsed;
  }

  if (!isRecord(data.overall)) return null;
  const overallTakes = nonNegativeInt(data.overall.takes);
  const overallSkips = nonNegativeInt(data.overall.skips);
  const overallResolved = nonNegativeInt(data.overall.resolvedActions);
  const overallRate = finiteNumber(data.overall.smoothedTakeRate);
  if (
    overallTakes === null ||
    overallSkips === null ||
    overallResolved === null ||
    overallRate === null
  ) {
    return null;
  }

  const topics = parseHints(data.topics);
  const authors = parseHints(data.authors);
  if (!topics || !authors) return null;

  if (!isRecord(data.familiarity)) return null;
  const score = nonNegativeInt(data.familiarity.score);
  if (
    score === null ||
    score > 100 ||
    typeof data.familiarity.state !== "string" ||
    !FAMILIARITY_STATES.has(data.familiarity.state)
  ) {
    return null;
  }

  let lastLearned: ScoutProfile["lastLearned"];
  if (data.lastLearned === null) {
    lastLearned = null;
  } else {
    if (!isRecord(data.lastLearned)) return null;
    const at = isoOrNull(data.lastLearned.at);
    const action = data.lastLearned.action;
    const threadKind = data.lastLearned.threadKind;
    if (
      !at ||
      typeof action !== "string" ||
      !ACTIONS.has(action) ||
      !(
        threadKind === null ||
        (typeof threadKind === "string" &&
          (THREAD_KINDS as readonly string[]).includes(threadKind))
      )
    ) {
      return null;
    }
    lastLearned = {
      at,
      action: action as "take" | "skip" | "dismiss",
      threadKind: threadKind as ThreadKind | null,
    };
  }

  return {
    version: SCOUT_PROFILE_VERSION,
    userId: id,
    revision,
    updatedAt,
    counts,
    coverage: {
      storedConfirmedReplies,
      knownKindResolvedActions,
      unknownKindResolvedActions,
    },
    kinds,
    overall: {
      takes: overallTakes,
      skips: overallSkips,
      resolvedActions: overallResolved,
      smoothedTakeRate: overallRate,
    },
    topics,
    authors,
    familiarity: {
      state: data.familiarity.state as ScoutProfile["familiarity"]["state"],
      score,
    },
    lastLearned,
  };
}

// ------------------------------------------------------------------- storage

async function readStoredProfile(
  path: string,
  userId: string,
): Promise<ScoutProfile | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return parseStoredScoutProfile(raw, userId);
}

async function publishProfile(path: string, profile: ScoutProfile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Rebuild one user's projection from durable evidence and publish it.
 *
 * Under the per-user file lock: snapshot evidence, reduce, then compare with
 * the file on disk. Because the snapshot is taken while holding the lock and
 * the evidence revision is monotonic, a slower rebuild can never overwrite a
 * newer projection; a file whose revision differs from the snapshot (stale,
 * or from a reset database) is replaced by the evidence-backed one.
 */
export async function rebuildScoutProfile(
  userId: string,
  opts: ScoutProfileStoreOpts = {},
): Promise<ScoutProfile> {
  const id = requireEvidenceUserId(userId);
  const path = scoutProfilePathForUser(id, opts.profileDir);
  return withFileLock(path, async () => {
    let snapshot = readScoutEvidenceSnapshot(id);
    for (let attempt = 0; ; attempt++) {
      const profile = reduceScoutProfile(snapshot);
      const existing = await readStoredProfile(path, id);
      if (existing && existing.revision === profile.revision) {
        // Same evidence revision reduces to identical data; keep the file.
        return existing;
      }
      // Recheck the revision right before publication.
      const latest = readScoutEvidenceRevision(id);
      if (latest.revision === snapshot.revision) {
        await publishProfile(path, profile);
        return profile;
      }
      if (attempt + 1 >= REBUILD_ATTEMPTS) {
        throw new Error(
          `scout profile rebuild for ${id} could not observe a stable evidence revision`,
        );
      }
      snapshot = readScoutEvidenceSnapshot(id);
    }
  });
}

async function bootstrapReconcile(
  userId: string,
  opts: ScoutProfileStoreOpts,
): Promise<void> {
  if (opts.reconcile === false) return;
  if (typeof opts.reconcile === "function") {
    await opts.reconcile(userId);
    return;
  }
  await reconcileScoutEvidence({ userId, knowledgeRoot: opts.knowledgeRoot });
}

/**
 * Read a user's ScoutProfile. Blank identity is rejected. A stored
 * projection is reused only when its version, owner and revision match the
 * durable evidence revision; otherwise it is rebuilt from local evidence.
 * Storage or evidence failures propagate (fail closed) instead of yielding a
 * fabricated or foreign profile. A user with no evidence gets the
 * deterministic empty profile.
 */
export async function readScoutProfile(
  userId: string,
  opts: ScoutProfileStoreOpts = {},
): Promise<ScoutProfile> {
  const id = requireEvidenceUserId(userId);
  const path = scoutProfilePathForUser(id, opts.profileDir);
  const current = readScoutEvidenceRevision(id);
  const stored = await readStoredProfile(path, id);
  if (stored && stored.revision === current.revision) return stored;
  if (stored === null) {
    // No valid projection yet: fold legacy durable facts into evidence first.
    await bootstrapReconcile(id, opts);
  }
  return rebuildScoutProfile(id, opts);
}

/**
 * Register the projection hook. Loading this module wires material evidence
 * changes to a per-user rebuild; the evidence module itself never imports
 * the store.
 */
export function installScoutProfileProjection(
  opts: Pick<ScoutProfileStoreOpts, "profileDir"> = {},
): void {
  setScoutProfileRebuild(async (userId) => {
    await withoutScoutProfileProjectionNotifications(() => reconcileScoutEvidence({ userId }));
    return rebuildScoutProfile(userId, { profileDir: opts.profileDir, reconcile: false });
  });
}

installScoutProfileProjection();
