/**
 * Durable XP ledger for marked replies. Streak is consecutive UTC days
 * with an original, reply, or quote on the account — desk or off-desk.
 */
import { access, mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  listInteractionHistory,
  MAX_INTERACTION_STORE,
  type Interaction,
  type ReplyStatSnapshot,
} from "./interactionStore.js";
import { withFileLock } from "./fileLock.js";
import { getSolePlatformUserId } from "./authStore.js";
import { listOwnPostedAt } from "./ownPostStore.js";
import {
  toPublicGamification,
  unlockedAchievementIds,
  type GamificationPublic,
  type MarkProgress,
} from "./gamificationAchievements.js";
import {
  applyMarkToGamification,
  applyT24hBonus,
  levelFromXp,
  markXpForStreak,
  overlayStreakFromDays,
  overlayStreakFromHistory,
  seedGamificationFromHistory,
  utcDayKey,
  utcDaysFromHistory,
  type GamificationState,
  type MarkAward,
} from "./gamificationXp.js";

export {
  ACHIEVEMENTS,
  achievementUnlocked,
  achievementValue,
  listAchievements,
  pickNextGoal,
  toLeaderboardRow,
  toPublicGamification,
  unlockedAchievementIds,
  type AchievementDef,
  type AchievementKind,
  type AchievementPublic,
  type GamificationPublic,
  type LeaderboardRow,
  type MarkProgress,
  type NextGoal,
} from "./gamificationAchievements.js";
export {
  MARK_XP,
  MAX_T24H_BONUS_XP,
  STREAK_XP_TIERS,
  applyMarkToGamification,
  applyMissionXp,
  applyT24hBonus,
  bonusXpFromT24h,
  emptyGamificationState,
  levelFromXp,
  lifetimeMarksOf,
  markXpForStreak,
  prevUtcDayKey,
  overlayStreakFromDays,
  overlayStreakFromHistory,
  seedGamificationFromHistory,
  streakFromUtcDays,
  utcDaysFromHistory,
  utcDayKey,
  xpProgress,
  type GamificationState,
  type MarkAward,
} from "./gamificationXp.js";

export function defaultGamificationPath(): string {
  return resolve(process.cwd(), "data", "gamification.json");
}

/** Per-user ledger. Legacy `data/gamification.json` is adopted once. */
export function gamificationPathForUser(userId: string): string {
  return resolve(process.cwd(), "data", "gamification", `${userId.trim()}.json`);
}

export function legacyAdoptMarkerPath(): string {
  return resolve(process.cwd(), "data", "gamification", ".legacy-adopted");
}

function parseGamificationState(raw: string): GamificationState | null {
  try {
    const data = JSON.parse(raw) as Partial<GamificationState>;
    if (!data || typeof data !== "object") return null;
    const lifetimeXp =
      typeof data.lifetimeXp === "number" && Number.isFinite(data.lifetimeXp)
        ? Math.max(0, Math.floor(data.lifetimeXp))
        : 0;
    const currentStreak =
      typeof data.currentStreak === "number" &&
      Number.isFinite(data.currentStreak)
        ? Math.max(0, Math.floor(data.currentStreak))
        : 0;
    const longestStreak =
      typeof data.longestStreak === "number" &&
      Number.isFinite(data.longestStreak)
        ? Math.max(0, Math.floor(data.longestStreak))
        : 0;
    const lastMarkUtcDay =
      typeof data.lastMarkUtcDay === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(data.lastMarkUtcDay)
        ? data.lastMarkUtcDay
        : null;
    const bonusAwardedThreadIds = Array.isArray(data.bonusAwardedThreadIds)
      ? data.bonusAwardedThreadIds
          .filter(
            (id): id is string => typeof id === "string" && id.trim() !== "",
          )
          .map((id) => id.trim())
      : [];
    const markAwardedThreadIds = Array.isArray(data.markAwardedThreadIds)
      ? data.markAwardedThreadIds
          .filter(
            (id): id is string => typeof id === "string" && id.trim() !== "",
          )
          .map((id) => id.trim())
      : [];
    const updatedAt =
      typeof data.updatedAt === "string" && data.updatedAt.trim()
        ? data.updatedAt
        : new Date().toISOString();
    return {
      currentStreak,
      longestStreak: Math.max(longestStreak, currentStreak),
      lastMarkUtcDay,
      lifetimeXp,
      bonusAwardedThreadIds,
      markAwardedThreadIds,
      updatedAt,
    };
  } catch {
    return null;
  }
}

async function readGamificationFile(
  path: string,
): Promise<GamificationState | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    throw err;
  }
  const state = parseGamificationState(raw);
  if (state === null) {
    throw new Error("gamification file is not parseable: " + path);
  }
  return state;
}

async function writeGamificationFile(
  path: string,
  state: GamificationState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export type GamificationPaths = {
  gamificationPath?: string;
  interactionStorePath?: string;
  nowMs?: number;
  userId?: string;
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Explicit path wins. Else per-user file. The first user may adopt the
 * legacy sidecar once so current XP is not reset. Adoption runs under a
 * dedicated marker lock (re-checking both files), so concurrent first
 * requests can neither each copy the legacy ledger into their own file nor
 * race the adoption write against a locked mark write.
 */
export async function resolveGamificationPath(
  opts?: GamificationPaths,
): Promise<string> {
  if (opts?.gamificationPath) return opts.gamificationPath;
  const userId = opts?.userId?.trim();
  if (!userId) {
    // Single-user sidecar: interaction rows written before userId scoping have
    // no owner, so their awards fall back here. Route them to the sole platform
    // user's ledger instead of the retired legacy file, which adoption already
    // copied into that ledger and is never read again.
    const soleUserId = getSolePlatformUserId();
    if (soleUserId) {
      return resolveGamificationPath({ ...opts, userId: soleUserId });
    }
    return defaultGamificationPath();
  }
  const userPath = gamificationPathForUser(userId);
  if (await pathExists(userPath)) return userPath;
  const legacy = defaultGamificationPath();
  if (!(await pathExists(legacy))) return userPath;
  const marker = legacyAdoptMarkerPath();
  await mkdir(dirname(marker), { recursive: true });
  return withFileLock(marker, async () => {
    if (await pathExists(userPath)) return userPath;
    if (await pathExists(marker)) return userPath;
    const legacyState = await readGamificationFile(legacy);
    if (!legacyState) return userPath;
    // Marker first so a crash between the two writes can never allow a second
    // adoption; if the user file is lost, the caller seeds it from history.
    await writeFile(marker, `${userId}\n`, "utf8");
    await writeGamificationFile(userPath, legacyState);
    return userPath;
  });
}

function progressFromTransition(
  before: GamificationState,
  awarded: MarkAward,
  after: GamificationState,
): MarkProgress {
  const beforeIds = new Set(unlockedAchievementIds(before));
  return {
    markXp: awarded.markXp,
    streakMultiplier: awarded.streakMultiplier,
    leveledUp: levelFromXp(after.lifetimeXp) > levelFromXp(before.lifetimeXp),
    previousLevel: levelFromXp(before.lifetimeXp),
    unlockedAchievementIds: unlockedAchievementIds(after).filter(
      (id) => !beforeIds.has(id),
    ),
  };
}

const STREAK_POST_KINDS = ["original", "reply", "quote"] as const;

async function historyForStreak(opts: {
  userId?: string;
  storePath?: string;
}): Promise<Interaction[]> {
  const scoped = await listInteractionHistory({
    limit: MAX_INTERACTION_STORE,
    storePath: opts.storePath,
    userId: opts.userId,
  });
  if (!opts.userId) return scoped;
  const sole = getSolePlatformUserId();
  if (!sole || opts.userId !== sole) return scoped;
  const all = await listInteractionHistory({
    limit: MAX_INTERACTION_STORE,
    storePath: opts.storePath,
  });
  const extra = all.filter((row) => !row.userId);
  return extra.length === 0 ? scoped : [...scoped, ...extra];
}

function activityDaysForStreak(opts: {
  userId?: string;
  history: readonly Interaction[];
}): string[] {
  const days = new Set(utcDaysFromHistory(opts.history));
  if (!opts.userId) return [...days];
  for (const at of listOwnPostedAt({
    userId: opts.userId,
    kinds: [...STREAK_POST_KINDS],
    limit: 2000,
  })) {
    const ms = Date.parse(at);
    if (Number.isFinite(ms)) days.add(utcDayKey(ms));
  }
  return [...days];
}

function overlayActivityStreak(
  state: GamificationState,
  opts: { userId?: string; history: readonly Interaction[]; nowMs: number },
): GamificationState {
  return overlayStreakFromDays(
    state,
    activityDaysForStreak(opts),
    opts.nowMs,
  );
}

async function loadOrSeedState(opts: GamificationPaths): Promise<{
  path: string;
  state: GamificationState;
}> {
  const path = await resolveGamificationPath(opts);
  const nowMs = opts.nowMs ?? Date.now();
  const existing = await readGamificationFile(path);
  const history = await historyForStreak({
    storePath: opts.interactionStorePath,
    userId: opts.userId,
  });
  if (existing) {
    return {
      path,
      state: overlayActivityStreak(existing, {
        userId: opts.userId,
        history,
        nowMs,
      }),
    };
  }
  const seeded = seedGamificationFromHistory(history, nowMs);
  const state = overlayActivityStreak(seeded, {
    userId: opts.userId,
    history,
    nowMs,
  });
  await writeGamificationFile(path, state);
  return { path, state };
}

/**
 * Load ledger (seed from interaction history if missing), apply fn, persist.
 */
export async function withGamificationState<T>(opts: {
  gamificationPath?: string;
  interactionStorePath?: string;
  nowMs?: number;
  userId?: string;
  fn: (state: GamificationState) => { state: GamificationState; result: T };
}): Promise<T> {
  const path = await resolveGamificationPath(opts);
  return withFileLock(path, async () => {
    const loaded = await loadOrSeedState(opts);
    const { state: next, result } = opts.fn(loaded.state);
    await writeGamificationFile(loaded.path, next);
    return result;
  });
}

/** Record a successful Mark interacted. Idempotent per mark (threadId + at). */
export async function recordMarkGamification(
  opts?: GamificationPaths & { threadId?: string },
): Promise<GamificationPublic> {
  const path = await resolveGamificationPath(opts);
  const nowMs = opts?.nowMs ?? Date.now();
  const threadId = opts?.threadId?.trim() || undefined;
  const markKey = threadId
    ? `${threadId}:${new Date(nowMs).toISOString()}`
    : "";
  return withFileLock(path, async () => {
    const existing = await readGamificationFile(path);
    if (existing) {
      const history = await listInteractionHistory({
        limit: MAX_INTERACTION_STORE,
        storePath: opts?.interactionStorePath,
        userId: opts?.userId,
      });
      // Do not reconstruct the streak from the row this mark is about to
      // apply; re-marking a thread replaces its retained history row.
      const current = overlayStreakFromHistory(
        existing,
        history.filter(
          (row) =>
            !(
              threadId &&
              row.threadId === threadId &&
              row.at === new Date(nowMs).toISOString()
            ),
        ),
        nowMs,
      );
      // A mark retried after a soft-fail replays the same at, so it must not
      // credit XP/streak again; a re-mark with a new at is a new mark.
      if (threadId && current.markAwardedThreadIds.includes(markKey)) {
        return toPublicGamification(current, {
          progress: progressFromTransition(
            current,
            {
              markXp: 0,
              currentStreak: current.currentStreak,
              streakMultiplier: markXpForStreak(
                Math.max(1, current.currentStreak),
              ),
            },
            current,
          ),
        });
      }
      const { state: next, awarded } = applyMarkToGamification(
        current,
        nowMs,
        threadId,
      );
      await writeGamificationFile(path, next);
      return toPublicGamification(next, {
        progress: progressFromTransition(current, awarded, next),
      });
    }
    // First ledger write: seed from retained history (includes the mark that
    // just landed) so we do not double-apply XP/streak for that mark.
    const history = await listInteractionHistory({
      limit: MAX_INTERACTION_STORE,
      storePath: opts?.interactionStorePath,
      userId: opts?.userId,
    });
    let seeded = seedGamificationFromHistory(history, nowMs);
    let awarded: MarkAward = {
      markXp: 0,
      currentStreak: seeded.currentStreak,
      streakMultiplier: markXpForStreak(Math.max(1, seeded.currentStreak)),
    };
    let beforeMark = seeded;
    // Progress is diffed against beforeMark + the mark's own award, never the
    // full seed: newer retained rows must not re-celebrate their unlocks.
    let progressAfter = seeded;
    // No history yet (e.g. tests) or the mark is not part of the retained
    // history — still credit it exactly once.
    if (
      history.length === 0 ||
      (threadId && !seeded.markAwardedThreadIds.includes(markKey))
    ) {
      const applied = applyMarkToGamification(seeded, nowMs, threadId);
      beforeMark = seeded;
      seeded = applied.state;
      awarded = applied.awarded;
      progressAfter = applied.state;
    } else {
      // The seed replayed retained history including this mark (production
      // persists the interaction before this runs). Baseline progress on the
      // rows the seed replayed strictly before this mark's own row so only
      // this mark's unlocks and level-up are celebrated: a fresh user's first
      // mark still unlocks first_mark / levels up, while past unlocks the seed
      // replayed stay quiet. Comparing empty → seeded would re-celebrate all
      // of them. When this mark is not the newest retained row (a soft-failed
      // mark replayed ahead of newer rows), the strictly-older rows are the
      // faithful pre-mark baseline and the mark earns the tier its own replay
      // position credited, not the seed's final streak.
      const markMs = Date.parse(new Date(nowMs).toISOString());
      beforeMark = seedGamificationFromHistory(
        history.filter((row) => {
          const rowMs = Date.parse(row.at);
          return Number.isFinite(rowMs) && rowMs < markMs;
        }),
        nowMs,
      );
      const applied = applyMarkToGamification(beforeMark, markMs, threadId);
      awarded = {
        markXp: applied.awarded.markXp,
        currentStreak: seeded.currentStreak,
        streakMultiplier: applied.awarded.streakMultiplier,
      };
      progressAfter = applied.state;
    }
    await writeGamificationFile(path, seeded);
    return toPublicGamification(seeded, {
      progress: progressFromTransition(beforeMark, awarded, progressAfter),
    });
  });
}

/** Award t24h engagement bonus once per threadId. */
export async function recordT24hBonusGamification(opts: {
  threadId: string;
  snapshot: Pick<ReplyStatSnapshot, "views" | "likes">;
  gamificationPath?: string;
  interactionStorePath?: string;
  nowMs?: number;
  userId?: string;
}): Promise<GamificationPublic> {
  const nowMs = opts.nowMs ?? Date.now();
  return withGamificationState({
    gamificationPath: opts.gamificationPath,
    interactionStorePath: opts.interactionStorePath,
    userId: opts.userId,
    nowMs,
    fn: (state) => {
      const { state: next } = applyT24hBonus(
        state,
        opts.threadId,
        opts.snapshot,
        nowMs,
      );
      return { state: next, result: toPublicGamification(next) };
    },
  });
}

/**
 * Read public gamification snapshot. Read-only apart from the one-time legacy
 * adoption inside resolveGamificationPath: never persists a seeded ledger, so
 * a concurrent GET cannot race a first mark's ledger creation and cause that
 * mark to be double-counted.
 */
export async function getGamification(
  opts?: GamificationPaths,
): Promise<GamificationPublic> {
  const path = await resolveGamificationPath(opts);
  const nowMs = opts?.nowMs ?? Date.now();
  return withFileLock(path, async () => {
    const existing = await readGamificationFile(path);
    const history = await historyForStreak({
      storePath: opts?.interactionStorePath,
      userId: opts?.userId,
    });
    if (existing) {
      return toPublicGamification(
        overlayActivityStreak(existing, {
          userId: opts?.userId,
          history,
          nowMs,
        }),
      );
    }
    const seeded = seedGamificationFromHistory(history, nowMs);
    return toPublicGamification(
      overlayActivityStreak(seeded, {
        userId: opts?.userId,
        history,
        nowMs,
      }),
    );
  });
}
