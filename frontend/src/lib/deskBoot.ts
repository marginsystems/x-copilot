/** First-paint desk payload: GET /api/boot + last-good localStorage snapshot. */

import type { AuthSessionUser } from "../auth/types";
import {
  parseInteractionHistoryEntry,
  parseRetainedInteractionEntry,
  type DismissalHistoryEntry,
  type ExpiredHistoryEntry,
  type InteractionHistoryEntry,
  type RetainedInteractionEntry,
  type SkipHistoryEntry,
  type ThreadCard,
} from "../desk/types";
import {
  emptyActivityStats,
  parseActivityStats,
  type ActivityStats,
} from "./activityStats";
import { viewFromPath } from "./appView";
import { apiFetch } from "./apiBase";
import { isOwnerHint, readOwnerHint } from "./ownerHint";
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
import { parseScoutFamiliarity, type ScoutFamiliarity } from "./scoutFamiliarity";

export const DESK_BOOT_KEY = "x-copilot-desk-boot-v2";
const LEGACY_DESK_BOOT_KEY = "x-copilot-desk-boot-v1";
const MAX_CACHE_CHARS = 1_000_000;
const CACHE_WRITE_IDLE_MS = 2000;
const PROVISIONAL_BLOCKING_PARAMS = ["auth", "auth_error", "checkout"];

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

export type ScoutFlightPayload = {
  active: boolean;
  stage?: string | null;
  failure?: true;
};

export type LastScoutPayload = {
  ok: boolean;
  empty: boolean;
  snapshot?: LastScoutSnapshot;
  flight?: ScoutFlightPayload;
};

export type DeskBootDesk = {
  interacted: {
    interactions: InteractionHistoryEntry[];
    retainedInteractions: RetainedInteractionEntry[];
    activeIds: string[];
    blockedIds: string[];
    total: number;
    page: number;
    pageSize: number;
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
  gamification: GamificationStats;
  activityStats: ActivityStats;
  coaching: CoachingState | null;
  /**
   * Owned Scout familiarity (C13). `undefined` when the payload predates the
   * field; `null` when the server had no usable owned projection.
   */
  scoutFamiliarity?: ScoutFamiliarity | null;
};

export type DeskBootDeskPatch = Partial<DeskBootDesk>;

export type DeskBootPayload = {
  ok: true;
  authRequired: boolean;
  user: AuthSessionUser | null;
  ownerHint: string | null;
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
  return { ...raw, threadId: raw.threadId, author: raw.author, at: raw.at };
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
    isAdmin: Boolean(raw.isAdmin),
  };
}

function parseIdList(raw: unknown, fallback: string[]): string[] {
  const source = Array.isArray(raw) ? raw : fallback;
  return source.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function parseScoutFlight(raw: unknown): ScoutFlightPayload | undefined {
  if (!isRecord(raw)) return undefined;
  return {
    active: raw.active === true,
    stage: typeof raw.stage === "string" ? raw.stage : null,
    ...(raw.failure === true ? { failure: true as const } : {}),
  };
}

function isThreadCard(value: unknown): value is ThreadCard {
  if (!isRecord(value)) return false;
  if (!["id", "author", "text", "url"].every((key) => typeof value[key] === "string")) return false;
  if (!["createdAt", "summary", "opAuthor", "opText", "conversationId", "inReplyToId", "inReplyToScreenName", "intent", "reason"].every(
    (key) => value[key] === undefined || typeof value[key] === "string",
  )) return false;
  if (!["isReply", "isQuote", "hasNativeMedia", "opParentDerived"].every(
    (key) => value[key] === undefined || typeof value[key] === "boolean",
  )) return false;
  if (!["baitScore", "score", "views", "opViews"].every(
    (key) => value[key] === undefined || typeof value[key] === "number",
  )) return false;
  for (const key of ["mediaShortlinks", "flags"]) {
    const items = value[key];
    if (items !== undefined && (!Array.isArray(items) || !items.every((item: unknown) => typeof item === "string"))) return false;
  }
  return (value.surface === undefined || value.surface === "reply" || value.surface === "repost") &&
    (value.engage === undefined || value.engage === "skip" || value.engage === "consider" || value.engage === "priority") &&
    (value.threadKind === undefined || (typeof value.threadKind === "string" &&
      ["timely_take", "fact_add", "sharp_opinion", "lived_answer", "hollow_ask", "promo_context", "bare_news", "closed_thread", "other"].includes(value.threadKind)));
}

function isPipelineCounts(value: unknown): value is NonNullable<LastScoutSnapshot["pipelineCounts"]> {
  return isRecord(value) &&
    ["raw", "afterDedupe", "afterCooldown", "afterLength", "afterTriage"].every((key) => typeof value[key] === "number") &&
    ["afterSelfReply", "afterLinks"].every((key) => value[key] === undefined || typeof value[key] === "number");
}

function parseLastScout(raw: unknown): LastScoutPayload {
  if (!isRecord(raw)) return { ok: true, empty: true };
  const flight = parseScoutFlight(raw.flight);
  const snapshot = isRecord(raw.snapshot) ? raw.snapshot : null;
  const threads = Array.isArray(snapshot?.threads)
    ? snapshot.threads.filter(isThreadCard)
    : [];
  if (Array.isArray(snapshot?.threads) && snapshot.threads.length > 0 && threads.length === 0) {
    return { ok: false, empty: true, flight };
  }
  if (!snapshot || raw.empty === true || threads.length === 0) {
    return { ok: raw.ok !== false, empty: true, flight };
  }
  return {
    ok: raw.ok !== false,
    empty: false,
    flight,
    snapshot: {
      savedAt: typeof snapshot.savedAt === "string" ? snapshot.savedAt : "",
      queries: Array.isArray(snapshot.queries)
        ? snapshot.queries.filter((q): q is string => typeof q === "string")
        : undefined,
      threads,
      message: typeof snapshot.message === "string" ? snapshot.message : undefined,
      pipelineCounts: isPipelineCounts(snapshot.pipelineCounts)
        ? snapshot.pipelineCounts
        : undefined,
    },
  };
}

export function parseDeskBoot(raw: unknown): DeskBootPayload | null {
  if (!isRecord(raw) || raw.ok !== true) return null;
  const user = raw.user == null ? null : parseAuthSessionUser(raw.user);
  if (raw.user != null && !user) return null;
  const ownerHint = isOwnerHint(raw.ownerHint) ? raw.ownerHint : null;
  if (!isRecord(raw.desk)) {
    return {
      ok: true,
      authRequired: raw.authRequired !== false,
      user,
      ownerHint,
      desk: null,
    };
  }
  const desk = raw.desk;
  const interacted = isRecord(desk.interacted) ? desk.interacted : {};
  const dismissed = isRecord(desk.dismissed) ? desk.dismissed : {};
  const skipped = isRecord(desk.skipped) ? desk.skipped : {};
  const expired = isRecord(desk.expired) ? desk.expired : {};
  const forYouRaw = isRecord(desk.forYou) ? desk.forYou : {};
  const interactions = (Array.isArray(interacted.interactions)
    ? interacted.interactions
    : []
  )
    .map(parseInteractionHistoryEntry)
    .filter((row): row is InteractionHistoryEntry => Boolean(row));
  const retainedInteractions = (Array.isArray(interacted.retainedInteractions)
    ? interacted.retainedInteractions
    : interactions
  )
    .map(parseRetainedInteractionEntry)
    .filter((row): row is RetainedInteractionEntry => Boolean(row));
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
  const parsedGamification = parseGamificationPayload(desk.gamification);
  return {
    ok: true,
    authRequired: raw.authRequired !== false,
    user,
    ownerHint,
    desk: {
      interacted: {
        interactions,
        retainedInteractions,
        total: typeof interacted.total === "number" ? interacted.total : interactions.length,
        page: typeof interacted.page === "number" ? interacted.page : 1,
        pageSize: 10,
        blockedIds: parseIdList(
          interacted.blockedIds,
          retainedInteractions.flatMap((i) =>
            [i.threadId, i.conversationId, i.inReplyToId].filter(
              (id): id is string => Boolean(id?.trim()),
            ),
          ),
        ),
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
      gamification: parsedGamification?.stats ?? emptyGamificationStats(),
      activityStats: parseActivityStats(desk.activityStats) ?? emptyActivityStats("day"),
      coaching: parseCoachingPayload(desk.coaching),
      // Older payloads omit the key entirely; a present-but-unusable value is
      // "unavailable", and neither case invalidates the rest of the desk.
      ...("scoutFamiliarity" in desk
        ? { scoutFamiliarity: parseScoutFamiliarity(desk.scoutFamiliarity) }
        : {}),
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
let pendingWrite: { serialized: string; ownerHint: string; cancel: () => void } | null = null;
let flushListenersInstalled = false;

export function readDeskBootCache(
  store: Pick<Storage, "getItem"> | null = defaultStore(),
): DeskBootPayload | null {
  if (!store) return null;
  try {
    const parsed = parseDeskBoot(JSON.parse(store.getItem(DESK_BOOT_KEY) ?? "null"));
    return parsed?.user && parsed.ownerHint && parsed.desk ? parsed : null;
  } catch {
    return null;
  }
}

type ProvisionalReadOptions = {
  hint?: string | null;
  store?: Pick<Storage, "getItem"> | null;
  location?: Pick<Location, "pathname" | "search"> | null;
};

export function readProvisionalDeskBoot(
  options: ProvisionalReadOptions = {},
): DeskBootPayload | null {
  const hint = options.hint === undefined ? readOwnerHint() : options.hint;
  const location =
    options.location === undefined
      ? typeof window === "undefined"
        ? null
        : window.location
      : options.location;
  if (!hint || !location) return null;
  if (viewFromPath(location.pathname) !== "dashboard") return null;
  const params = new URLSearchParams(location.search);
  if (PROVISIONAL_BLOCKING_PARAMS.some((key) => params.has(key))) return null;
  const store = options.store === undefined ? defaultStore() : options.store;
  const cached = readDeskBootCache(store);
  if (!cached || cached.ownerHint !== hint) return null;
  const user = cached.user;
  if (!user || !user.onboardingCompleted || !user.xLinked) return null;
  if (options.store === undefined) peekMemo = cached;
  return cached;
}

/** Display data only. Callers must supply an owner verified by the server.
 * Omitting the owner deliberately gives unverified hook initializers no seed.
 */
export function peekDeskBootCache(
  verifiedOwnerId: string | null = null,
): DeskBootPayload | null {
  if (!verifiedOwnerId) return null;
  if (peekMemo !== undefined) {
    return peekMemo?.user?.id === verifiedOwnerId ? peekMemo : null;
  }
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.has("auth") || params.has("auth_error")) {
      peekMemo = null;
      return null;
    }
  }
  peekMemo = readDeskBootCache();
  return peekMemo?.user?.id === verifiedOwnerId ? peekMemo : null;
}

function cancelPendingWrite(): void {
  pendingWrite?.cancel();
  pendingWrite = null;
}

function commitWrite(serialized: string, ownerHint: string): void {
  const target = defaultStore();
  if (!target) return;
  try {
    if (readOwnerHint() !== ownerHint) {
      removeCacheKeys(target);
      return;
    }
    if (target.getItem(DESK_BOOT_KEY) === serialized) return;
    target.removeItem(LEGACY_DESK_BOOT_KEY);
    target.setItem(DESK_BOOT_KEY, serialized);
  } catch {
    return;
  }
}

export function flushDeskBootWrite(): void {
  const pending = pendingWrite;
  if (!pending) return;
  cancelPendingWrite();
  commitWrite(pending.serialized, pending.ownerHint);
}

function installFlushListeners(): void {
  if (flushListenersInstalled || typeof window === "undefined") return;
  flushListenersInstalled = true;
  window.addEventListener("pagehide", flushDeskBootWrite);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushDeskBootWrite();
  });
}

function scheduleWrite(serialized: string, ownerHint: string): void {
  cancelPendingWrite();
  installFlushListeners();
  const run = () => {
    pendingWrite = null;
    commitWrite(serialized, ownerHint);
  };
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: CACHE_WRITE_IDLE_MS });
    pendingWrite = { serialized, ownerHint, cancel: () => window.cancelIdleCallback(handle) };
    return;
  }
  const handle = setTimeout(run, 0);
  pendingWrite = { serialized, ownerHint, cancel: () => clearTimeout(handle) };
}

function removeCacheKeys(target: Pick<Storage, "removeItem">): void {
  target.removeItem(DESK_BOOT_KEY);
  target.removeItem(LEGACY_DESK_BOOT_KEY);
}

export function writeDeskBootCache(
  payload: DeskBootPayload,
  store?: Pick<Storage, "setItem" | "removeItem"> | null,
): void {
  const deferred = store === undefined;
  const target = deferred ? defaultStore() : store;
  if (deferred) {
    cancelPendingWrite();
    peekMemo = payload.user && payload.ownerHint ? payload : null;
  }
  if (!target) return;
  try {
    const serialized =
      payload.user && payload.ownerHint ? JSON.stringify(payload) : null;
    if (
      serialized === null ||
      serialized.length > MAX_CACHE_CHARS ||
      (deferred && payload.ownerHint !== readOwnerHint())
    ) {
      removeCacheKeys(target);
      return;
    }
    if (deferred && payload.ownerHint) {
      scheduleWrite(serialized, payload.ownerHint);
      return;
    }
    target.removeItem(LEGACY_DESK_BOOT_KEY);
    target.setItem(DESK_BOOT_KEY, serialized);
  } catch {
    /* private mode / quota */
  }
}

export function clearDeskBootCache(
  store?: Pick<Storage, "removeItem"> | null,
): void {
  const deferred = store === undefined;
  const target = deferred ? defaultStore() : store;
  if (deferred) {
    cancelPendingWrite();
    peekMemo = null;
  }
  if (!target) return;
  try {
    removeCacheKeys(target);
  } catch {
    /* private mode */
  }
}

export async function fetchDeskBoot(
  dedupeAccounts: boolean,
  signal?: AbortSignal,
): Promise<DeskBootFetch> {
  try {
    const res = await apiFetch(`/api/boot?dedupeAccounts=${dedupeAccounts}`, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
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
