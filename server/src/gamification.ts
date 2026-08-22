/**
 * Durable streak + XP ledger for marked replies.
 * Counters live in data/gamification.json so interaction retain caps cannot erase progress.
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

export const MARK_XP = 1;
export const MAX_T24H_BONUS_XP = 5;

/** Integer XP for one successful mark at this UTC streak. */
export const STREAK_XP_TIERS = [
  { min: 1, xp: 1 },
  { min: 3, xp: 2 },
  { min: 7, xp: 3 },
  { min: 14, xp: 4 },
  { min: 30, xp: 5 },
] as const;

export type AchievementKind = "streak" | "level" | "marks";

export type AchievementDef = {
  id: string;
  title: string;
  detail: string;
  kind: AchievementKind;
  threshold: number;
};

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: "first_mark",
    title: "First reply",
    detail: "Mark your first interacted thread",
    kind: "marks",
    threshold: 1,
  },
  {
    id: "marks_10",
    title: "Warming up",
    detail: "10 marked replies",
    kind: "marks",
    threshold: 10,
  },
  {
    id: "marks_50",
    title: "Regular",
    detail: "50 marked replies",
    kind: "marks",
    threshold: 50,
  },
  {
    id: "marks_100",
    title: "Century",
    detail: "100 marked replies",
    kind: "marks",
    threshold: 100,
  },
  {
    id: "marks_250",
    title: "Deep bench",
    detail: "250 marked replies",
    kind: "marks",
    threshold: 250,
  },
  {
    id: "streak_3",
    title: "On a run",
    detail: "3 UTC days in a row",
    kind: "streak",
    threshold: 3,
  },
  {
    id: "streak_7",
    title: "Week locked",
    detail: "7 UTC days in a row",
    kind: "streak",
    threshold: 7,
  },
  {
    id: "streak_14",
    title: "Fortnight",
    detail: "14 UTC days in a row",
    kind: "streak",
    threshold: 14,
  },
  {
    id: "streak_30",
    title: "Month locked",
    detail: "30 UTC days in a row",
    kind: "streak",
    threshold: 30,
  },
  {
    id: "level_5",
    title: "Scout",
    detail: "Reach level 5",
    kind: "level",
    threshold: 5,
  },
  {
    id: "level_10",
    title: "Operator",
    detail: "Reach level 10",
    kind: "level",
    threshold: 10,
  },
  {
    id: "level_15",
    title: "Veteran",
    detail: "Reach level 15",
    kind: "level",
    threshold: 15,
  },
  {
    id: "level_25",
    title: "Ace",
    detail: "Reach level 25",
    kind: "level",
    threshold: 25,
  },
];

export type AchievementPublic = AchievementDef & {
  unlocked: boolean;
};

export type NextGoal = {
  id: string;
  kind: AchievementKind;
  title: string;
  detail: string;
  remaining: number;
};

export type MarkProgress = {
  markXp: number;
  streakMultiplier: number;
  leveledUp: boolean;
  previousLevel: number;
  unlockedAchievementIds: string[];
};

export type LeaderboardRow = {
  userId: string;
  lifetimeXp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  lifetimeMarks: number;
};

export type GamificationState = {
  currentStreak: number;
  longestStreak: number;
  lastMarkUtcDay: string | null;
  lifetimeXp: number;
  bonusAwardedThreadIds: string[];
  markAwardedThreadIds: string[];
  updatedAt: string;
};

export type GamificationPublic = {
  currentStreak: number;
  longestStreak: number;
  lifetimeXp: number;
  level: number;
  xpIntoLevel: number;
  xpToNext: number;
  lastMarkUtcDay: string | null;
  lifetimeMarks: number;
  streakMultiplier: number;
  markXpAtStreak: number;
  nextGoal: NextGoal;
  achievements: AchievementPublic[];
  progress?: MarkProgress;
};

export type MarkAward = {
  markXp: number;
  currentStreak: number;
  streakMultiplier: number;
};

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

export function markXpForStreak(streak: number): number {
  const n = Math.max(0, Math.floor(streak));
  let xp = MARK_XP;
  for (const tier of STREAK_XP_TIERS) {
    if (n >= tier.min) xp = tier.xp;
  }
  return xp;
}

export function lifetimeMarksOf(state: GamificationState): number {
  return state.markAwardedThreadIds.length;
}

export function achievementValue(
  def: AchievementDef,
  state: GamificationState,
): number {
  if (def.kind === "streak") {
    return Math.max(state.currentStreak, state.longestStreak);
  }
  if (def.kind === "level") return levelFromXp(state.lifetimeXp);
  return lifetimeMarksOf(state);
}

export function achievementUnlocked(
  def: AchievementDef,
  state: GamificationState,
): boolean {
  return achievementValue(def, state) >= def.threshold;
}

export function listAchievements(state: GamificationState): AchievementPublic[] {
  return ACHIEVEMENTS.map((def) => ({
    ...def,
    unlocked: achievementUnlocked(def, state),
  }));
}

export function unlockedAchievementIds(state: GamificationState): string[] {
  return ACHIEVEMENTS.filter((def) => achievementUnlocked(def, state)).map(
    (def) => def.id,
  );
}

export function pickNextGoal(state: GamificationState): NextGoal {
  const progress = xpProgress(state.lifetimeXp);
  const xpRemaining = Math.max(0, progress.xpToNext - progress.xpIntoLevel);
  const nextMarkXp = markXpForStreak(Math.max(1, state.currentStreak));
  const nextLevelId = `level_${progress.level + 1}`;
  const nextLevelDef = ACHIEVEMENTS.find((def) => def.id === nextLevelId);
  if (nextLevelDef && xpRemaining > 0 && xpRemaining <= nextMarkXp) {
    return {
      id: nextLevelDef.id,
      kind: "level",
      title: nextLevelDef.title,
      detail: `${xpRemaining} XP to go`,
      remaining: xpRemaining,
    };
  }

  const nextStreak = ACHIEVEMENTS.find(
    (def) => def.kind === "streak" && !achievementUnlocked(def, state),
  );
  if (nextStreak && state.currentStreak > 0) {
    return {
      id: nextStreak.id,
      kind: "streak",
      title: nextStreak.title,
      detail: `${nextStreak.threshold - state.currentStreak} more UTC day(s)`,
      remaining: Math.max(0, nextStreak.threshold - state.currentStreak),
    };
  }

  const nextMarks = ACHIEVEMENTS.find(
    (def) => def.kind === "marks" && !achievementUnlocked(def, state),
  );
  if (nextMarks) {
    const have = lifetimeMarksOf(state);
    return {
      id: nextMarks.id,
      kind: "marks",
      title: nextMarks.title,
      detail: `${nextMarks.threshold - have} more mark(s)`,
      remaining: Math.max(0, nextMarks.threshold - have),
    };
  }

  // Every catalog goal is out of reach or already unlocked; keep nextGoal.id
  // resolvable against ACHIEVEMENTS by pointing at the final level badge.
  const lastLevelDef =
    nextLevelDef ?? [...ACHIEVEMENTS].reverse().find((def) => def.kind === "level");
  return {
    id: lastLevelDef?.id ?? "level_25",
    kind: "level",
    title: `Level ${progress.level + 1}`,
    detail: `${xpRemaining} XP to go`,
    remaining: xpRemaining,
  };
}

export function toLeaderboardRow(
  userId: string,
  state: GamificationState,
): LeaderboardRow {
  return {
    userId,
    lifetimeXp: state.lifetimeXp,
    level: levelFromXp(state.lifetimeXp),
    currentStreak: state.currentStreak,
    longestStreak: state.longestStreak,
    lifetimeMarks: lifetimeMarksOf(state),
  };
}

export function emptyGamificationState(
  nowMs: number = Date.now(),
): GamificationState {
  return {
    currentStreak: 0,
    longestStreak: 0,
    lastMarkUtcDay: null,
    lifetimeXp: 0,
    bonusAwardedThreadIds: [],
    markAwardedThreadIds: [],
    updatedAt: new Date(nowMs).toISOString(),
  };
}

/** UTC calendar day `YYYY-MM-DD`. */
export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function parseUtcDayKey(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(t) ? t : null;
}

/** Previous UTC calendar day key. */
export function prevUtcDayKey(day: string): string | null {
  const t = parseUtcDayKey(day);
  if (t === null) return null;
  return utcDayKey(t - 24 * 60 * 60 * 1000);
}

export function levelFromXp(lifetimeXp: number): number {
  const xp = Math.max(0, Math.floor(lifetimeXp));
  return 1 + Math.floor(Math.sqrt(xp));
}

/** XP progress within the current level toward the next. */
export function xpProgress(lifetimeXp: number): {
  level: number;
  xpIntoLevel: number;
  xpToNext: number;
} {
  const xp = Math.max(0, Math.floor(lifetimeXp));
  const level = levelFromXp(xp);
  const levelStart = (level - 1) * (level - 1);
  const nextStart = level * level;
  return {
    level,
    xpIntoLevel: xp - levelStart,
    xpToNext: Math.max(1, nextStart - levelStart),
  };
}

export function toPublicGamification(
  state: GamificationState,
  opts?: { progress?: MarkProgress },
): GamificationPublic {
  const progress = xpProgress(state.lifetimeXp);
  const streakMultiplier = markXpForStreak(Math.max(1, state.currentStreak));
  const pub: GamificationPublic = {
    currentStreak: state.currentStreak,
    longestStreak: state.longestStreak,
    lifetimeXp: state.lifetimeXp,
    level: progress.level,
    xpIntoLevel: progress.xpIntoLevel,
    xpToNext: progress.xpToNext,
    lastMarkUtcDay: state.lastMarkUtcDay,
    lifetimeMarks: lifetimeMarksOf(state),
    streakMultiplier,
    markXpAtStreak: streakMultiplier,
    nextGoal: pickNextGoal(state),
    achievements: listAchievements(state),
  };
  if (opts?.progress) pub.progress = opts.progress;
  return pub;
}

export function bonusXpFromT24h(
  snapshot: Pick<ReplyStatSnapshot, "views" | "likes"> | null | undefined,
): number {
  if (!snapshot) return 0;
  const views =
    typeof snapshot.views === "number" &&
    Number.isFinite(snapshot.views) &&
    snapshot.views >= 0
      ? Math.floor(snapshot.views)
      : 0;
  const likes =
    typeof snapshot.likes === "number" &&
    Number.isFinite(snapshot.likes) &&
    snapshot.likes >= 0
      ? Math.floor(snapshot.likes)
      : 0;
  return Math.min(MAX_T24H_BONUS_XP, Math.floor(views / 100) + likes);
}

/**
 * XP a backdated mark (soft-failed and replayed after a newer mark already
 * advanced the ledger) should earn on its own UTC day. The ledger only keeps
 * the current streak counters, so replay the credited mark instances
 * (`threadId:at` keys) up to the mark's day to recover the streak tier that
 * was in effect then — a retry must not be credited at the current streak's
 * multiplier.
 */
function backdatedMarkXp(
  state: GamificationState,
  nowMs: number,
  threadId?: string,
): number {
  const day = utcDayKey(nowMs);
  const priorMarks = state.markAwardedThreadIds
    .map((key) => {
      // Keys are `threadId:<ISO at>`; the at itself contains colons, so match
      // the trailing ISO timestamp rather than splitting on the last colon.
      const m = key.match(
        /:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)$/,
      );
      if (!m) return null;
      const t = Date.parse(m[1]);
      return Number.isFinite(t) && utcDayKey(t) <= day ? t : null;
    })
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);
  let replay = emptyGamificationState(nowMs);
  for (const ms of priorMarks) {
    replay = applyMarkToGamification(replay, ms).state;
  }
  return applyMarkToGamification(replay, nowMs, threadId).awarded.markXp;
}

/**
 * Apply a successful Mark interacted to the ledger.
 * Same UTC day: streak unchanged, still awards XP at the current multiplier.
 * Yesterday UTC: streak += 1, then award at the new multiplier.
 * Older / null: streak = 1.
 */
export function applyMarkToGamification(
  state: GamificationState,
  nowMs: number = Date.now(),
  threadId?: string,
): { state: GamificationState; awarded: MarkAward } {
  const id = threadId?.trim() || "";
  // Retry idempotency key is the mark instance (threadId + exact at): a retry
  // replays the same at, while a re-mark of the same thread has a new at and is
  // still a new mark (+1 XP, advances streak).
  const markKey = `${id || "anon"}:${new Date(nowMs).toISOString()}`;
  if (id && state.markAwardedThreadIds.includes(markKey)) {
    // Idempotent: this mark instance's XP/streak was already credited.
    return {
      state,
      awarded: {
        markXp: 0,
        currentStreak: state.currentStreak,
        streakMultiplier: markXpForStreak(Math.max(1, state.currentStreak)),
      },
    };
  }
  const day = utcDayKey(nowMs);
  const last = state.lastMarkUtcDay;

  // A backdated mark (e.g. a soft-failed mark retried after a newer mark
  // already advanced the ledger) must not reset the streak or move the
  // lastMarkUtcDay cursor backward — credit XP only.
  if (last && day < last) {
    const markXp = backdatedMarkXp(state, nowMs, threadId);
    return {
      state: {
        ...state,
        lifetimeXp: state.lifetimeXp + markXp,
        markAwardedThreadIds: [...state.markAwardedThreadIds, markKey],
        updatedAt: new Date(nowMs).toISOString(),
      },
      awarded: {
        markXp,
        currentStreak: state.currentStreak,
        streakMultiplier: markXp,
      },
    };
  }

  let currentStreak = state.currentStreak;

  if (!last) {
    currentStreak = 1;
  } else if (last === day) {
    currentStreak = Math.max(1, currentStreak);
  } else if (prevUtcDayKey(day) === last) {
    currentStreak = Math.max(1, currentStreak) + 1;
  } else {
    currentStreak = 1;
  }

  const longestStreak = Math.max(state.longestStreak, currentStreak);
  const markXp = markXpForStreak(currentStreak);
  const next: GamificationState = {
    ...state,
    currentStreak,
    longestStreak,
    lastMarkUtcDay: day,
    lifetimeXp: state.lifetimeXp + markXp,
    markAwardedThreadIds: [...state.markAwardedThreadIds, markKey],
    updatedAt: new Date(nowMs).toISOString(),
  };
  return {
    state: next,
    awarded: { markXp, currentStreak, streakMultiplier: markXp },
  };
}

/** Award t24h bonus XP once per threadId. */
export function applyT24hBonus(
  state: GamificationState,
  threadId: string,
  snapshot: Pick<ReplyStatSnapshot, "views" | "likes"> | null | undefined,
  nowMs: number = Date.now(),
): { state: GamificationState; bonusXp: number } {
  const id = threadId.trim();
  if (!id) return { state, bonusXp: 0 };
  if (state.bonusAwardedThreadIds.includes(id)) {
    return { state, bonusXp: 0 };
  }
  const bonusXp = bonusXpFromT24h(snapshot);
  const bonusAwardedThreadIds = [...state.bonusAwardedThreadIds, id];
  return {
    state: {
      ...state,
      lifetimeXp: state.lifetimeXp + bonusXp,
      bonusAwardedThreadIds,
      updatedAt: new Date(nowMs).toISOString(),
    },
    bonusXp,
  };
}

/** Replay retained history into a fresh ledger (oldest mark first). */
export function seedGamificationFromHistory(
  history: readonly Interaction[],
  nowMs: number = Date.now(),
): GamificationState {
  const sorted = [...history].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
  let state = emptyGamificationState(nowMs);
  for (const row of sorted) {
    const markMs = Date.parse(row.at);
    if (!Number.isFinite(markMs)) continue;
    state = applyMarkToGamification(state, markMs, row.threadId).state;
    if (row.stats?.t24h) {
      state = applyT24hBonus(state, row.threadId, row.stats.t24h, markMs).state;
    }
  }
  return { ...state, updatedAt: new Date(nowMs).toISOString() };
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

async function loadOrSeedState(opts: GamificationPaths): Promise<{
  path: string;
  state: GamificationState;
}> {
  const path = await resolveGamificationPath(opts);
  const nowMs = opts.nowMs ?? Date.now();
  const existing = await readGamificationFile(path);
  if (existing) return { path, state: existing };
  const history = await listInteractionHistory({
    limit: MAX_INTERACTION_STORE,
    storePath: opts.interactionStorePath,
    userId: opts.userId,
  });
  const state = seedGamificationFromHistory(history, nowMs);
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
      // A mark retried after a soft-fail replays the same at, so it must not
      // credit XP/streak again; a re-mark with a new at is a new mark.
      if (threadId && existing.markAwardedThreadIds.includes(markKey)) {
        return toPublicGamification(existing, {
          progress: progressFromTransition(
            existing,
            {
              markXp: 0,
              currentStreak: existing.currentStreak,
              streakMultiplier: markXpForStreak(
                Math.max(1, existing.currentStreak),
              ),
            },
            existing,
          ),
        });
      }
      const { state: next, awarded } = applyMarkToGamification(
        existing,
        nowMs,
        threadId,
      );
      await writeGamificationFile(path, next);
      return toPublicGamification(next, {
        progress: progressFromTransition(existing, awarded, next),
      });
    }
    // First ledger write: seed from retained history (includes the mark that
    // just landed) so we do not double-apply XP/streak for that mark.
    const history = await listInteractionHistory({
      limit: MAX_INTERACTION_STORE,
      storePath: opts?.interactionStorePath,
      userId: opts?.userId,
    });
    const empty = emptyGamificationState(nowMs);
    let seeded = seedGamificationFromHistory(history, nowMs);
    let awarded: MarkAward = {
      markXp: 0,
      currentStreak: seeded.currentStreak,
      streakMultiplier: markXpForStreak(Math.max(1, seeded.currentStreak)),
    };
    // No history yet (e.g. tests) or the mark is not part of the retained
    // history — still credit it exactly once.
    if (
      history.length === 0 ||
      (threadId && !seeded.markAwardedThreadIds.includes(markKey))
    ) {
      const applied = applyMarkToGamification(seeded, nowMs, threadId);
      seeded = applied.state;
      awarded = applied.awarded;
    } else {
      awarded = {
        markXp: markXpForStreak(Math.max(1, seeded.currentStreak)),
        currentStreak: seeded.currentStreak,
        streakMultiplier: markXpForStreak(Math.max(1, seeded.currentStreak)),
      };
    }
    await writeGamificationFile(path, seeded);
    return toPublicGamification(seeded, {
      progress: progressFromTransition(empty, awarded, seeded),
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
    if (existing) return toPublicGamification(existing);
    const history = await listInteractionHistory({
      limit: MAX_INTERACTION_STORE,
      storePath: opts?.interactionStorePath,
      userId: opts?.userId,
    });
    return toPublicGamification(seedGamificationFromHistory(history, nowMs));
  });
}
