/**
 * Durable streak + XP ledger for marked replies.
 * Counters live in data/gamification.json so interaction retain caps cannot erase progress.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  listInteractionHistory,
  MAX_INTERACTION_STORE,
  withFileLock,
  type Interaction,
  type ReplyStatSnapshot,
} from "./interactionStore.js";

export const MARK_XP = 1;
export const MAX_T24H_BONUS_XP = 5;

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
};

export type MarkAward = {
  markXp: number;
  currentStreak: number;
};

export function defaultGamificationPath(): string {
  return resolve(process.cwd(), "data", "gamification.json");
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
): GamificationPublic {
  const progress = xpProgress(state.lifetimeXp);
  return {
    currentStreak: state.currentStreak,
    longestStreak: state.longestStreak,
    lifetimeXp: state.lifetimeXp,
    level: progress.level,
    xpIntoLevel: progress.xpIntoLevel,
    xpToNext: progress.xpToNext,
    lastMarkUtcDay: state.lastMarkUtcDay,
  };
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
 * Apply a successful Mark interacted to the ledger.
 * Same UTC day: streak unchanged, still +1 XP.
 * Yesterday UTC: streak += 1.
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
  const markKey = id ? `${id}:${new Date(nowMs).toISOString()}` : "";
  if (id && state.markAwardedThreadIds.includes(markKey)) {
    // Idempotent: this mark instance's XP/streak was already credited.
    return {
      state,
      awarded: { markXp: 0, currentStreak: state.currentStreak },
    };
  }
  const day = utcDayKey(nowMs);
  const last = state.lastMarkUtcDay;

  // A backdated mark (e.g. a soft-failed mark retried after a newer mark
  // already advanced the ledger) must not reset the streak or move the
  // lastMarkUtcDay cursor backward — credit XP only.
  if (last && day < last) {
    return {
      state: {
        ...state,
        lifetimeXp: state.lifetimeXp + MARK_XP,
        markAwardedThreadIds: id
          ? [...state.markAwardedThreadIds, markKey]
          : state.markAwardedThreadIds,
        updatedAt: new Date(nowMs).toISOString(),
      },
      awarded: { markXp: MARK_XP, currentStreak: state.currentStreak },
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
  const next: GamificationState = {
    ...state,
    currentStreak,
    longestStreak,
    lastMarkUtcDay: day,
    lifetimeXp: state.lifetimeXp + MARK_XP,
    markAwardedThreadIds: id
      ? [...state.markAwardedThreadIds, markKey]
      : state.markAwardedThreadIds,
    updatedAt: new Date(nowMs).toISOString(),
  };
  return {
    state: next,
    awarded: { markXp: MARK_XP, currentStreak },
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
  try {
    const raw = await readFile(path, "utf8");
    return parseGamificationState(raw);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    console.error("gamification read failed:", err);
    return null;
  }
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
};

async function loadOrSeedState(opts: GamificationPaths): Promise<{
  path: string;
  state: GamificationState;
}> {
  const path = opts.gamificationPath ?? defaultGamificationPath();
  const nowMs = opts.nowMs ?? Date.now();
  const existing = await readGamificationFile(path);
  if (existing) return { path, state: existing };
  const history = await listInteractionHistory({
    limit: MAX_INTERACTION_STORE,
    storePath: opts.interactionStorePath,
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
  fn: (state: GamificationState) => { state: GamificationState; result: T };
}): Promise<T> {
  const path = opts.gamificationPath ?? defaultGamificationPath();
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
  const path = opts?.gamificationPath ?? defaultGamificationPath();
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
        return toPublicGamification(existing);
      }
      const { state: next } = applyMarkToGamification(existing, nowMs, threadId);
      await writeGamificationFile(path, next);
      return toPublicGamification(next);
    }
    // First ledger write: seed from retained history (includes the mark that
    // just landed) so we do not double-apply XP/streak for that mark.
    const history = await listInteractionHistory({
      limit: MAX_INTERACTION_STORE,
      storePath: opts?.interactionStorePath,
    });
    let seeded = seedGamificationFromHistory(history, nowMs);
    // No history yet (e.g. tests) or the mark is not part of the retained
    // history — still credit it exactly once.
    if (
      history.length === 0 ||
      (threadId && !seeded.markAwardedThreadIds.includes(markKey))
    ) {
      seeded = applyMarkToGamification(seeded, nowMs, threadId).state;
    }
    await writeGamificationFile(path, seeded);
    return toPublicGamification(seeded);
  });
}

/** Award t24h engagement bonus once per threadId. */
export async function recordT24hBonusGamification(opts: {
  threadId: string;
  snapshot: Pick<ReplyStatSnapshot, "views" | "likes">;
  gamificationPath?: string;
  interactionStorePath?: string;
  nowMs?: number;
}): Promise<GamificationPublic> {
  const nowMs = opts.nowMs ?? Date.now();
  return withGamificationState({
    gamificationPath: opts.gamificationPath,
    interactionStorePath: opts.interactionStorePath,
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
 * Read public gamification snapshot. Read-only: never persists a seeded
 * ledger, so a concurrent GET cannot race a first mark's ledger creation and
 * cause that mark to be double-counted.
 */
export async function getGamification(
  opts?: GamificationPaths,
): Promise<GamificationPublic> {
  const path = opts?.gamificationPath ?? defaultGamificationPath();
  const nowMs = opts?.nowMs ?? Date.now();
  return withFileLock(path, async () => {
    const existing = await readGamificationFile(path);
    if (existing) return toPublicGamification(existing);
    const history = await listInteractionHistory({
      limit: MAX_INTERACTION_STORE,
      storePath: opts?.interactionStorePath,
    });
    return toPublicGamification(seedGamificationFromHistory(history, nowMs));
  });
}
