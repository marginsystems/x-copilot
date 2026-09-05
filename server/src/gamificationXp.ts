import type { Interaction, ReplyStatSnapshot } from "./interactionStore.js";
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
export type GamificationState = {
  currentStreak: number;
  longestStreak: number;
  lastMarkUtcDay: string | null;
  lifetimeXp: number;
  bonusAwardedThreadIds: string[];
  markAwardedThreadIds: string[];
  updatedAt: string;
};

export type MarkAward = {
  markXp: number;
  currentStreak: number;
  streakMultiplier: number;
};
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

/** Flat XP for a completed daily mission. Caller must be idempotent. */
export function applyMissionXp(
  state: GamificationState,
  xp: number,
  nowMs: number = Date.now(),
): GamificationState {
  const add = Math.max(0, Math.floor(xp));
  if (add === 0) return state;
  return {
    ...state,
    lifetimeXp: state.lifetimeXp + add,
    updatedAt: new Date(nowMs).toISOString(),
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
    if (row.source !== "discovered" && row.stats?.t24h) {
      state = applyT24hBonus(state, row.threadId, row.stats.t24h, markMs).state;
    }
  }
  return { ...state, updatedAt: new Date(nowMs).toISOString() };
}

/** UTC days that keep a streak: one original, reply, or quote. */
export function utcDaysFromHistory(
  history: readonly Interaction[],
): string[] {
  const days = new Set<string>();
  for (const row of history) {
    const raw = row.postedAt ?? row.at;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) continue;
    days.add(utcDayKey(ms));
  }
  return [...days];
}

export function streakFromUtcDays(
  days: readonly string[],
  today: string,
): {
  currentStreak: number;
  lastDay: string | null;
  longestStreak: number;
} {
  const unique = [...new Set(days.filter(Boolean))].sort();
  if (unique.length === 0) {
    return { currentStreak: 0, lastDay: null, longestStreak: 0 };
  }
  let longest = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    const prev = unique[i - 1];
    const cur = unique[i];
    if (prev && cur && prevUtcDayKey(cur) === prev) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }
  const lastDay = unique[unique.length - 1] ?? null;
  const alive = lastDay === today || lastDay === prevUtcDayKey(today);
  let currentStreak = 0;
  if (alive && lastDay) {
    currentStreak = 1;
    for (let i = unique.length - 1; i > 0; i--) {
      const prev = unique[i - 1];
      const cur = unique[i];
      if (prev && cur && prevUtcDayKey(cur) === prev) currentStreak += 1;
      else break;
    }
  }
  return { currentStreak, lastDay, longestStreak: longest };
}

/** Streak from activity UTC days. Does not change XP. */
export function overlayStreakFromDays(
  state: GamificationState,
  days: readonly string[],
  nowMs: number = Date.now(),
): GamificationState {
  if (days.length === 0) return state;
  const computed = streakFromUtcDays(days, utcDayKey(nowMs));
  const currentStreak = computed.currentStreak;
  const lastMarkUtcDay = computed.lastDay;
  const longestStreak = Math.max(state.longestStreak, computed.longestStreak);
  if (
    currentStreak === state.currentStreak &&
    lastMarkUtcDay === state.lastMarkUtcDay &&
    longestStreak === state.longestStreak
  ) {
    return state;
  }
  return {
    ...state,
    currentStreak,
    lastMarkUtcDay,
    longestStreak,
  };
}

/** Streak from interacted history. Does not change XP. */
export function overlayStreakFromHistory(
  state: GamificationState,
  history: readonly Interaction[],
  nowMs: number = Date.now(),
): GamificationState {
  return overlayStreakFromDays(state, utcDaysFromHistory(history), nowMs);
}
