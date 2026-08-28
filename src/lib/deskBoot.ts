/** First-paint desk payload: GET /api/boot + last-good localStorage snapshot. */

import type { AuthSessionUser } from "../auth/types";
import type {
  DismissalHistoryEntry,
  ExpiredHistoryEntry,
  InteractionHistoryEntry,
  ScoutLogEntry,
  SkipHistoryEntry,
  ThreadCard,
} from "../desk/types";
import {
  emptyActivityStats,
  parseActivityStats,
  type ActivityStats,
} from "./activityStats";
import { apiFetch } from "./apiBase";
import { parseCoachingPayload, type CoachingState } from "./coaching";
import {
  parseForYouExtra,
  parseForYouProgress,
  parseForYouSuggestion,
  type ForYouExtraUsage,
  type ForYouProgress,
  type ForYouSuggestion,
} from "./forYou";
import {
  emptyGamificationStats,
  parseGamificationPayload,
  type GamificationStats,
} from "./gamification";

export const DESK_BOOT_KEY = "x-copilot-desk-boot-v1";

export type LastScoutSnapshot = {
  savedAt: string;
  queries?: string[];
  threads: ThreadCard[];
  message?: string;
  pipelineCounts?: {
    raw: number;
    afterDedupe: number;
    afterCooldown: number;
    afterSelfReply?: number;
    afterLinks?: number;
    afterLength: number;
    afterTriage: number;
  };
};

export type LastScoutPayload = {
  ok: boolean;
  empty: boolean;
  snapshot?: LastScoutSnapshot;
};

export type DeskBootDesk = {
  interacted: {
    interactions: InteractionHistoryEntry[];
    activeIds: string[];
  };
  dismissed: {
    dismissals: DismissalHistoryEntry[];
    dismissedIds: string[];
  };
  skipped: {
    skipped: SkipHistoryEntry[];
    skippedIds: string[];
  };
  expired: {
    expired: ExpiredHistoryEntry[];
    expiredIds: string[];
  };
  forYou: {
    suggestions: ForYouSuggestion[];
    progress: ForYouProgress | null;
    extra: ForYouExtraUsage | null;
  };
  lastScout: LastScoutPayload;
  scoutLog: ScoutLogEntry[];
  gamification: GamificationStats;
  activityStats: ActivityStats;
  coaching: CoachingState | null;
};

export type DeskBootPayload = {
  ok: true;
  authRequired: boolean;
  user: AuthSessionUser | null;
  desk: DeskBootDesk | null;
};

export type DeskBootFetch =
  | { status: "ok"; payload: DeskBootPayload }
  | { status: "unauthenticated"; authRequired: boolean }
  | { status: "missing" }
  | { status: "error" };

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return Boolean(raw) && typeof raw === "object";
}

function historyRow(raw: unknown): { threadId: string; author: string; at: string } | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.threadId !== "string" ||
    typeof raw.author !== "string" ||
    typeof raw.at !== "string"
  ) {
    return null;
  }
  return raw as { threadId: string; author: string; at: string };
}

export function parseAuthSessionUser(raw: unknown): AuthSessionUser | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) return null;
  return {
    id: raw.id,
    email: typeof raw.email === "string" ? raw.email : null,
    displayName: typeof raw.displayName === "string" ? raw.displayName : null,
    avatarUrl: typeof raw.avatarUrl === "string" ? raw.avatarUrl : null,
    onboardingCompleted: raw.onboardingCompleted !== false,
    agenda:
      typeof raw.agenda === "string" && raw.agenda.trim() ? raw.agenda : null,
    xUsername:
      typeof raw.xUsername === "string" && raw.xUsername.trim()
        ? raw.xUsername.replace(/^@+/, "")
        : null,
    xLinked: Boolean(raw.xLinked),
    xCanPost: Boolean(raw.xCanPost),
    isAdmin: Boolean(raw.isAdmin),
  };
}

function parseIdList(raw: unknown, fallback: string[]): string[] {
  const source = Array.isArray(raw) ? raw : fallback;
  return source.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function parseLastScout(raw: unknown): LastScoutPayload {
  if (!isRecord(raw)) return { ok: true, empty: true };
  const snapshot = isRecord(raw.snapshot) ? raw.snapshot : null;
  const threads = Array.isArray(snapshot?.threads)
    ? (snapshot.threads as ThreadCard[])
    : [];
  if (!snapshot || raw.empty === true || threads.length === 0) {
    return { ok: raw.ok !== false, empty: true };
  }
  return {
    ok: raw.ok !== false,
    empty: false,
    snapshot: {
      savedAt: typeof snapshot.savedAt === "string" ? snapshot.savedAt : "",
      queries: Array.isArray(snapshot.queries)
        ? snapshot.queries.filter((q): q is string => typeof q === "string")
        : undefined,
      threads,
      message: typeof snapshot.message === "string" ? snapshot.message : undefined,
      pipelineCounts: isRecord(snapshot.pipelineCounts)
        ? (snapshot.pipelineCounts as LastScoutSnapshot["pipelineCounts"])
        : undefined,
    },
  };
}

export function parseDeskBoot(raw: unknown): DeskBootPayload | null {
  if (!isRecord(raw) || raw.ok !== true) return null;
  const user = raw.user == null ? null : parseAuthSessionUser(raw.user);
  if (raw.user != null && !user) return null;
  if (!isRecord(raw.desk)) {
    return {
      ok: true,
      authRequired: raw.authRequired !== false,
      user,
      desk: null,
    };
  }
  const desk = raw.desk;
  const interacted = isRecord(desk.interacted) ? desk.interacted : {};
  const dismissed = isRecord(desk.dismissed) ? desk.dismissed : {};
  const skipped = isRecord(desk.skipped) ? desk.skipped : {};
  const expired = isRecord(desk.expired) ? desk.expired : {};
  const forYouRaw = isRecord(desk.forYou) ? desk.forYou : {};
  const scoutLogRaw = desk.scoutLog;
  const scoutLogEntries = Array.isArray(scoutLogRaw)
    ? scoutLogRaw
    : isRecord(scoutLogRaw) && Array.isArray(scoutLogRaw.entries)
      ? (scoutLogRaw.entries as unknown[])
      : [];
  const interactions = (Array.isArray(interacted.interactions)
    ? interacted.interactions
    : []
  ).filter((row): row is InteractionHistoryEntry => Boolean(historyRow(row)));
  const dismissals = (Array.isArray(dismissed.dismissals)
    ? dismissed.dismissals
    : []
  ).filter((row): row is DismissalHistoryEntry => Boolean(historyRow(row)));
  const skippedRows = (Array.isArray(skipped.skipped) ? skipped.skipped : []).filter(
    (row): row is SkipHistoryEntry => Boolean(historyRow(row)),
  );
  const expiredRows = (Array.isArray(expired.expired) ? expired.expired : []).filter(
    (row): row is ExpiredHistoryEntry => Boolean(historyRow(row)),
  );
  const suggestions = (Array.isArray(forYouRaw.suggestions)
    ? forYouRaw.suggestions
    : []
  )
    .map(parseForYouSuggestion)
    .filter((row): row is ForYouSuggestion => Boolean(row));
  const entries = scoutLogEntries.filter(
    (e): e is ScoutLogEntry =>
      Boolean(e) &&
      typeof (e as ScoutLogEntry).message === "string" &&
      typeof (e as ScoutLogEntry).at === "string",
  );
  const parsedGamification = parseGamificationPayload(desk.gamification);
  return {
    ok: true,
    authRequired: raw.authRequired !== false,
    user,
    desk: {
      interacted: {
        interactions,
        activeIds: parseIdList(
          interacted.activeIds,
          interactions.map((i) => i.threadId),
        ),
      },
      dismissed: {
        dismissals,
        dismissedIds: parseIdList(
          dismissed.dismissedIds,
          dismissals.map((d) => d.threadId),
        ),
      },
      skipped: {
        skipped: skippedRows,
        skippedIds: parseIdList(
          skipped.skippedIds,
          skippedRows.map((d) => d.threadId),
        ),
      },
      expired: {
        expired: expiredRows,
        expiredIds: parseIdList(
          expired.expiredIds,
          expiredRows.map((e) => e.threadId),
        ),
      },
      forYou: {
        suggestions,
        progress:
          parseForYouProgress(forYouRaw) ??
          (isRecord(forYouRaw.progress)
            ? parseForYouProgress(forYouRaw.progress)
            : null),
        extra: parseForYouExtra(forYouRaw),
      },
      lastScout: parseLastScout(desk.lastScout),
      scoutLog: entries.slice(-1000),
      gamification: parsedGamification?.stats ?? emptyGamificationStats(),
      activityStats: parseActivityStats(desk.activityStats) ?? emptyActivityStats("day"),
      coaching: parseCoachingPayload(desk.coaching),
    },
  };
}

function defaultStore(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

let peekMemo: DeskBootPayload | null | undefined;

export function readDeskBootCache(
  store: Pick<Storage, "getItem"> | null = defaultStore(),
): DeskBootPayload | null {
  if (!store) return null;
  try {
    const parsed = parseDeskBoot(JSON.parse(store.getItem(DESK_BOOT_KEY) ?? "null"));
    return parsed?.user ? parsed : null;
  } catch {
    return null;
  }
}

export function peekDeskBootCache(): DeskBootPayload | null {
  if (peekMemo !== undefined) return peekMemo;
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.has("auth") || params.has("auth_error")) {
      peekMemo = null;
      return null;
    }
  }
  peekMemo = readDeskBootCache();
  return peekMemo;
}

export function writeDeskBootCache(
  payload: DeskBootPayload,
  store?: Pick<Storage, "setItem" | "removeItem"> | null,
): void {
  const target = store === undefined ? defaultStore() : store;
  if (store === undefined) peekMemo = payload.user ? payload : null;
  if (!target) return;
  try {
    if (!payload.user) {
      target.removeItem(DESK_BOOT_KEY);
      return;
    }
    target.setItem(DESK_BOOT_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota */
  }
}

export function clearDeskBootCache(
  store?: Pick<Storage, "removeItem"> | null,
): void {
  const target = store === undefined ? defaultStore() : store;
  if (store === undefined) peekMemo = null;
  if (!target) return;
  try {
    target.removeItem(DESK_BOOT_KEY);
  } catch {
    /* private mode */
  }
}

export async function fetchDeskBoot(
  dedupeAccounts: boolean,
): Promise<DeskBootFetch> {
  try {
    const res = await apiFetch(`/api/boot?dedupeAccounts=${dedupeAccounts}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (res.status === 404) return { status: "missing" };
    const data: unknown = await res.json().catch(() => null);
    if (res.status === 401) {
      const authRequired =
        isRecord(data) && data.authRequired === false ? false : true;
      return { status: "unauthenticated", authRequired };
    }
    if (!res.ok) return { status: "error" };
    const payload = parseDeskBoot(data);
    if (!payload) return { status: "error" };
    return { status: "ok", payload };
  } catch {
    return { status: "error" };
  }
}
