import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useSession } from "../auth/session";
import { apiFetch } from "../lib/apiBase";
import type { DeskBootDeskPatch } from "../lib/deskBoot";
import { isRecord } from "../lib/typeGuards";
import { parseDeskBoot, peekDeskBootCache } from "../lib/deskBoot";
import {
  parseForYouExtra,
  parseForYouProgress,
  parseForYouSuggestion,
  type ForYouExtraUsage,
  type ForYouProgress,
  type ForYouSuggestion,
} from "../lib/forYou";
import type { AppSettings } from "../lib/settings";
import { onDeskEvent, useDeskEventStream } from "./deskEventStream";
import { armReplyPace } from "./replyPaceStore";
import {
  parseInteractionHistoryEntry,
  type DismissalHistoryEntry,
  type ExpiredHistoryEntry,
  type InteractionHistoryEntry,
  type SkipHistoryEntry,
  type ThreadCard,
} from "./types";

export const INTERACTED_PAGE_SIZE = 10;
export const INTERACTED_FALLBACK_POLL_MS = 30_000;

export function parseInteractedHistory(
  raw: unknown,
): InteractionHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(parseInteractionHistoryEntry)
    .filter((row): row is InteractionHistoryEntry => Boolean(row));
}

function blockedFromHistory(
  rows: ReadonlyArray<{
    threadId: string;
    conversationId?: string;
    inReplyToId?: string;
  }>,
): Set<string> {
  const blocked = new Set<string>();
  for (const i of rows) {
    const root =
      i.conversationId?.trim() || i.inReplyToId?.trim() || i.threadId.trim();
    if (root) blocked.add(root);
    if (i.threadId.trim()) blocked.add(i.threadId.trim());
    if (i.inReplyToId?.trim()) blocked.add(i.inReplyToId.trim());
  }
  return blocked;
}

/**
 * Run `refresh` when the tab returns to the foreground. A reply posted from
 * the phone lands as `discovered` while the desk tab is hidden. Scout Approach
 * also refreshes this endpoint briefly while its locked card is active.
 */
export function useRehydrateOnVisible(refresh: () => void | Promise<void>) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      Promise.resolve(refreshRef.current()).catch((err: unknown) => console.error(err));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () =>
      document.removeEventListener("visibilitychange", onVisibility);
  }, []);
}

export type DeskHistoryDeps = {
  setThreads: Dispatch<SetStateAction<ThreadCard[]>>;
  setStatus: (s: string) => void;
  setActionBusy: (b: boolean) => void;
  settings: AppSettings;
  /**
   * Runs after a current interacted/skipped/dismissed hydration commits,
   * even when the returned ids did not change (a note repair can move
   * familiarity coverage). Never runs for stale or failed refreshes.
   */
  onHydrated?: (slice: "interacted" | "skipped" | "dismissed") => void;
};

export function keepCuratedByHistory(
  thread: Pick<ThreadCard, "id" | "conversationId" | "inReplyToId">,
  isHiddenById: (id: string) => boolean,
  blockedConversations: ReadonlySet<string>,
  preservedId?: string | null,
): boolean {
  if (preservedId && thread.id === preservedId) return true;
  return !(
    isHiddenById(thread.id) ||
    blockedConversations.has(thread.id) ||
    (thread.conversationId &&
      blockedConversations.has(thread.conversationId)) ||
    (thread.inReplyToId && blockedConversations.has(thread.inReplyToId))
  );
}

export function useDeskHistory(
  deps: DeskHistoryDeps,
  verifiedOwnerId: string | null,
) {
  const { setThreads, setStatus, setActionBusy, onHydrated } = deps;
  const onHydratedRef = useRef(onHydrated);
  onHydratedRef.current = onHydrated;
  const session = useSession();
  // Page clicks have their own sequence: Scout polls and visibility refreshes
  // call the unpaged endpoint constantly and must not discard the user's page.
  const requestSeq = useRef({
    interacted: 0, interactedPage: 0, skipped: 0, dismissed: 0, expired: 0, forYou: 0,
  });
  const lifetime = useRef(0);
  useEffect(() => () => { lifetime.current++; }, []);

  function beginRefresh(key: keyof typeof requestSeq.current) {
    const generation = session.capture();
    const mounted = lifetime.current;
    const seq = ++requestSeq.current[key];
    return () =>
      session.isCurrent(generation) && mounted === lifetime.current &&
      seq === requestSeq.current[key];
  }

  const seed = peekDeskBootCache(verifiedOwnerId)?.desk ?? null;
  const [interactedIds, setInteractedIds] = useState<Set<string>>(
    () => new Set(seed?.interacted.activeIds ?? []),
  );
  const [interactedHistory, setInteractedHistory] = useState<
    InteractionHistoryEntry[]
  >(() => seed?.interacted.interactions ?? []);
  const [interactedRetainedHistory, setInteractedRetainedHistory] = useState<
    InteractionHistoryEntry[]
  >(() => seed?.interacted.retainedInteractions ?? seed?.interacted.interactions ?? []);
  const interactedRetainedRef = useRef(interactedRetainedHistory);
  const unpagedInFlightRef = useRef<Promise<void> | null>(null);
  const appliedUnpagedBodyRef = useRef<string | null>(null);
  const [interactedTotal, setInteractedTotal] = useState(seed?.interacted.total ?? 0);
  const [interactedPage, setInteractedPage] = useState(seed?.interacted.page ?? 1);
  const interactedPageRef = useRef(seed?.interacted.page ?? 1);
  const [interactedHydrated, setInteractedHydrated] = useState(false);
  const [dismissedHistory, setDismissedHistory] = useState<
    DismissalHistoryEntry[]
  >(() => seed?.dismissed.dismissals ?? []);
  const [skippedHistory, setSkippedHistory] = useState<SkipHistoryEntry[]>(
    () => seed?.skipped.skipped ?? [],
  );
  const [expiredHistory, setExpiredHistory] = useState<ExpiredHistoryEntry[]>(
    () => seed?.expired.expired ?? [],
  );
  const [forYouSuggestions, setForYouSuggestions] = useState<
    ForYouSuggestion[]
  >(() => seed?.forYou.suggestions ?? []);
  const [forYouProgress, setForYouProgress] = useState<ForYouProgress | null>(
    () => seed?.forYou.progress ?? null,
  );
  const [forYouExtra, setForYouExtra] = useState<ForYouExtraUsage | null>(
    () => seed?.forYou.extra ?? null,
  );

  const dismissedIdsRef = useRef<Set<string>>(
    new Set(seed?.dismissed.dismissedIds ?? []),
  );
  const skippedIdsRef = useRef<Set<string>>(
    new Set(seed?.skipped.skippedIds ?? []),
  );
  const expiredIdsRef = useRef<Set<string>>(
    new Set(seed?.expired.expiredIds ?? []),
  );
  const interactedIdsRef = useRef<Set<string>>(
    new Set(seed?.interacted.activeIds ?? []),
  );
  const blockedConversationsRef = useRef<Set<string>>(
    new Set([
      ...(seed?.interacted.blockedIds ?? []),
      ...blockedFromHistory(seed?.dismissed.dismissals ?? []),
      ...blockedFromHistory(seed?.skipped.skipped ?? []),
    ]),
  );
  /** Set once a user action mutates history locally; boot's server snapshot is then stale. */
  const historyStaleRef = useRef(false);
  const preservedIdRef = useRef<string | null>(null);

  function commitRetained(rows: InteractionHistoryEntry[]) {
    interactedRetainedRef.current = rows;
    setInteractedRetainedHistory(rows);
  }

  function applyHistoryFromBoot(desk: DeskBootDeskPatch) {
    if (historyStaleRef.current) return;
    if (desk.interacted) {
      appliedUnpagedBodyRef.current = null;
      setInteractedHydrated(true);
      setInteractedHistory(desk.interacted.interactions);
      commitRetained(desk.interacted.retainedInteractions);
      setInteractedTotal(desk.interacted.total);
      setInteractedPage(desk.interacted.page);
      interactedPageRef.current = desk.interacted.page;
      const ids = new Set(desk.interacted.activeIds);
      interactedIdsRef.current = ids;
      setInteractedIds(ids);
    }
    if (desk.dismissed) {
      setDismissedHistory(desk.dismissed.dismissals);
      dismissedIdsRef.current = new Set(desk.dismissed.dismissedIds);
    }
    if (desk.skipped) {
      setSkippedHistory(desk.skipped.skipped);
      skippedIdsRef.current = new Set(desk.skipped.skippedIds);
    }
    if (desk.expired) {
      setExpiredHistory(desk.expired.expired);
      expiredIdsRef.current = new Set(desk.expired.expiredIds);
    }
    if (desk.interacted || desk.dismissed || desk.skipped || desk.expired) {
      const blocked = new Set(blockedConversationsRef.current);
      if (desk.interacted) blockedConversationsRef.current = new Set([
        ...blocked,
        ...desk.interacted.blockedIds,
      ]);
      if (desk.dismissed) blockedConversationsRef.current = new Set([
        ...blockedConversationsRef.current,
        ...blockedFromHistory(desk.dismissed.dismissals),
      ]);
      if (desk.skipped) blockedConversationsRef.current = new Set([
        ...blockedConversationsRef.current,
        ...blockedFromHistory(desk.skipped.skipped),
      ]);
      setThreads((prev) => prev.filter((t) => keepInCurated(t)));
    }
    if (desk.forYou) {
      setForYouSuggestions(desk.forYou.suggestions);
      setForYouProgress(desk.forYou.progress);
      setForYouExtra(desk.forYou.extra);
    }
  }

  /**
   * Preservation belongs to the locked Scout card. Passing a new id transfers
   * it synchronously, so a card released a moment ago leaves inventory before
   * any later selection, not after the next network round trip.
   */
  function hydrateInteracted(preservedId?: string | null, page?: number): Promise<void> {
    const run = loadInteracted(preservedId, page);
    if (page !== undefined) return run;
    unpagedInFlightRef.current = run;
    const settle = () => {
      if (unpagedInFlightRef.current === run) unpagedInFlightRef.current = null;
    };
    run.then(settle, settle);
    return run;
  }

  function pollInteracted(): Promise<void> {
    return unpagedInFlightRef.current ?? hydrateInteracted();
  }

  function applyInteractedEvent(raw: unknown) {
    const entry = parseInteractionHistoryEntry(raw);
    if (!entry) return;
    appliedUnpagedBodyRef.current = null;
    const known = interactedRetainedRef.current.some((row) => row.threadId === entry.threadId);
    commitRetained([
      entry,
      ...interactedRetainedRef.current.filter((row) => row.threadId !== entry.threadId),
    ]);
    if (!known) setInteractedTotal((total) => total + 1);
    if (interactedPageRef.current === 1) {
      setInteractedHistory((rows) =>
        [entry, ...rows.filter((row) => row.threadId !== entry.threadId)].slice(0, INTERACTED_PAGE_SIZE),
      );
    }
    const ids = new Set(interactedIdsRef.current);
    ids.add(entry.threadId);
    interactedIdsRef.current = ids;
    setInteractedIds(ids);
    blockedConversationsRef.current = new Set([
      ...blockedConversationsRef.current,
      ...blockedFromHistory([entry]),
    ]);
    setThreads((prev) => prev.filter((t) => keepInCurated(t)));
    hydrateInteracted().catch((err: unknown) => console.error(err));
  }

  async function loadInteracted(preservedId?: string | null, page?: number) {
    const paged = page !== undefined;
    const isCurrent = beginRefresh(paged ? "interactedPage" : "interacted");
    if (!isCurrent()) return;
    // A page response is older than any unpaged refresh started after it.
    const unpagedSeq = requestSeq.current.interacted;
    const newestSnapshot = () => !paged || unpagedSeq === requestSeq.current.interacted;
    if (!paged) setInteractedHydrated(false);
    if (preservedId !== undefined) {
      const changed = preservedIdRef.current !== preservedId;
      preservedIdRef.current = preservedId;
      if (changed || preservedId === null) {
        setThreads((prev) => prev.filter((t) => keepInCurated(t)));
      }
    }
    try {
      const res = await apiFetch(page === undefined ? "/api/interacted" : `/api/interacted?page=${page}`);
      if (!isCurrent()) return;
      if (!res.ok) throw new Error("Refresh failed");
      const body = await res.text();
      if (!isCurrent()) return;
      if (!paged && body === appliedUnpagedBodyRef.current) {
        onHydratedRef.current?.("interacted");
        return;
      }
      const raw: unknown = JSON.parse(body);
      const data = isRecord(raw) ? raw : {};
      const history = parseInteractedHistory(data.interactions);
      const serverBlocked = Array.isArray(data.blockedIds)
        ? new Set(data.blockedIds.filter((id): id is string => typeof id === "string"))
        : null;
      if (!paged) {
        const pageIds = new Set(history.map((row) => row.threadId));
        commitRetained([
          ...history,
          ...interactedRetainedRef.current.filter(
            (row) => !pageIds.has(row.threadId) && (!serverBlocked || serverBlocked.has(row.threadId)),
          ),
        ]);
        appliedUnpagedBodyRef.current = body;
      } else {
        appliedUnpagedBodyRef.current = null;
      }
      if (newestSnapshot()) {
        setInteractedTotal(typeof data.total === "number" ? data.total : history.length);
      }
      if (paged) {
        const nextPage = typeof data.page === "number" ? data.page : page;
        interactedPageRef.current = nextPage;
        setInteractedPage(nextPage);
        setInteractedHistory(history);
      } else if (interactedPageRef.current === 1) {
        setInteractedHistory(history);
      }
      const ids = new Set(
        (Array.isArray(data.activeIds) ? data.activeIds : []).filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      );
      if (!paged) {
        interactedIdsRef.current = ids;
        setInteractedIds(ids);
      }
      const blocked = new Set(blockedConversationsRef.current);
      const blockedIds = Array.isArray(data.blockedIds)
        ? data.blockedIds
        : blockedFromHistory(paged ? history : interactedRetainedRef.current);
      for (const id of blockedIds) {
        if (typeof id === "string" && id.trim()) blocked.add(id.trim());
      }
      blockedConversationsRef.current = blocked;
      if (ids.size || blocked.size) {
        setThreads((prev) =>
          prev.filter((t) =>
            keepCuratedByHistory(
              t,
              isHiddenFromCurated,
              blockedConversationsRef.current,
              preservedIdRef.current,
            ),
          ),
        );
      }
      if (!paged) onHydratedRef.current?.("interacted");
    } catch {
      if (isCurrent()) setStatus("Could not refresh interacted history. Try again.");
    } finally {
      if (!paged && isCurrent()) setInteractedHydrated(true);
    }
  }

  useRehydrateOnVisible(hydrateInteracted);
  useDeskEventStream(verifiedOwnerId);
  const deskEventHandlersRef = useRef({ applyInteractedEvent, pollInteracted });
  deskEventHandlersRef.current = { applyInteractedEvent, pollInteracted };
  useEffect(() => {
    if (!verifiedOwnerId) return;
    const poll = () => {
      deskEventHandlersRef.current.pollInteracted().catch((err: unknown) => console.error(err));
    };
    const offInteracted = onDeskEvent("interacted", (data) => {
      deskEventHandlersRef.current.applyInteractedEvent(data);
    });
    const offReady = onDeskEvent("ready", poll);
    const interval = window.setInterval(poll, INTERACTED_FALLBACK_POLL_MS);
    return () => {
      offInteracted();
      offReady();
      window.clearInterval(interval);
    };
  }, [verifiedOwnerId]);

  function isHiddenFromCurated(id: string): boolean {
    return (
      dismissedIdsRef.current.has(id) ||
      skippedIdsRef.current.has(id) ||
      expiredIdsRef.current.has(id) ||
      interactedIdsRef.current.has(id)
    );
  }

  function keepInCurated(thread: ThreadCard): boolean {
    return keepCuratedByHistory(
      thread,
      isHiddenFromCurated,
      blockedConversationsRef.current,
      preservedIdRef.current,
    );
  }

  async function hydrateSkipped() {
    const isCurrent = beginRefresh("skipped");
    if (!isCurrent()) return;
    try {
      const res = await apiFetch("/api/skipped");
      if (!isCurrent()) return;
      if (!res.ok) throw new Error("Refresh failed");
      const raw: unknown = await res.json();
      const data = isRecord(raw) ? raw : {};
      if (!isCurrent()) return;
      const history = parseDeskBoot({ ok: true, desk: { skipped: data } })?.desk?.skipped.skipped ?? [];
      setSkippedHistory(history);
      const ids = new Set(
        (Array.isArray(data.skippedIds)
          ? data.skippedIds
          : history.map((d) => d.threadId)
        ).filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      );
      skippedIdsRef.current = ids;
      const blocked = new Set(blockedConversationsRef.current);
      for (const d of history) {
        const root =
          d.conversationId?.trim() ||
          d.inReplyToId?.trim() ||
          d.threadId.trim();
        if (root) blocked.add(root);
        if (d.threadId.trim()) blocked.add(d.threadId.trim());
        if (d.inReplyToId?.trim()) blocked.add(d.inReplyToId.trim());
      }
      blockedConversationsRef.current = blocked;
      if (ids.size || blocked.size) {
        setThreads((prev) => prev.filter((t) => keepInCurated(t)));
      }
      onHydratedRef.current?.("skipped");
    } catch {
      if (isCurrent()) setStatus("Could not refresh skipped history. Try again.");
    }
  }

  async function hydrateDismissed() {
    const isCurrent = beginRefresh("dismissed");
    if (!isCurrent()) return;
    try {
      const res = await apiFetch("/api/dismissed");
      if (!isCurrent()) return;
      if (!res.ok) throw new Error("Refresh failed");
      const raw: unknown = await res.json();
      const data = isRecord(raw) ? raw : {};
      if (!isCurrent()) return;
      const history = parseDeskBoot({ ok: true, desk: { dismissed: data } })?.desk?.dismissed.dismissals ?? [];
      setDismissedHistory(history);
      const ids = new Set(
        (Array.isArray(data.dismissedIds) ? data.dismissedIds : history.map((d) => d.threadId)).filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      );
      dismissedIdsRef.current = ids;
      const blocked = new Set(blockedConversationsRef.current);
      for (const d of history) {
        const root =
          d.conversationId?.trim() ||
          d.inReplyToId?.trim() ||
          d.threadId.trim();
        if (root) blocked.add(root);
        if (d.threadId.trim()) blocked.add(d.threadId.trim());
        if (d.inReplyToId?.trim()) blocked.add(d.inReplyToId.trim());
      }
      blockedConversationsRef.current = blocked;
      if (ids.size || blocked.size) {
        setThreads((prev) => prev.filter((t) => keepInCurated(t)));
      }
      onHydratedRef.current?.("dismissed");
    } catch {
      if (isCurrent()) setStatus("Could not refresh dismissed history. Try again.");
    }
  }

  async function hydrateExpired() {
    const isCurrent = beginRefresh("expired");
    if (!isCurrent()) return;
    try {
      const res = await apiFetch("/api/expired");
      if (!isCurrent()) return;
      if (!res.ok) throw new Error("Refresh failed");
      const raw: unknown = await res.json();
      const data = isRecord(raw) ? raw : {};
      if (!isCurrent()) return;
      const history = parseDeskBoot({ ok: true, desk: { expired: data } })?.desk?.expired.expired ?? [];
      setExpiredHistory(history);
      const ids = new Set(
        (Array.isArray(data.expiredIds)
          ? data.expiredIds
          : history.map((e) => e.threadId)
        ).filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      );
      expiredIdsRef.current = ids;
      if (ids.size) {
        setThreads((prev) => prev.filter((t) => !isHiddenFromCurated(t.id)));
      }
    } catch {
      if (isCurrent()) setStatus("Could not refresh expired history. Try again.");
    }
  }

  async function hydrateForYou() {
    const isCurrent = beginRefresh("forYou");
    if (!isCurrent()) return;
    try {
      const res = await apiFetch("/api/for-you");
      if (!isCurrent()) return;
      if (!res.ok) throw new Error("Refresh failed");
      const raw: unknown = await res.json();
      const data = isRecord(raw) ? raw : {};
      if (!isCurrent()) return;
      const rows = (Array.isArray(data.suggestions) ? data.suggestions : [])
        .map(parseForYouSuggestion)
        .filter((row): row is ForYouSuggestion => Boolean(row));
      setForYouSuggestions(rows);
      setForYouProgress(parseForYouProgress(data));
      setForYouExtra(parseForYouExtra(data));
    } catch {
      if (isCurrent()) setStatus("Could not refresh For You. Try again.");
    }
  }

  async function actForYou(
    id: string,
    path: "done" | "skip" | "dismiss",
  ): Promise<boolean | "gone"> {
    setActionBusy(true);
    try {
      const res = await apiFetch(`/api/for-you/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        if (res.status === 404) {
          requestSeq.current.forYou++;
          setForYouSuggestions((prev) => prev.filter((row) => row.id !== id));
          historyStaleRef.current = true;
          if (path === "skip" || path === "dismiss") {
            await hydrateForYou();
          }
          return path === "done" ? "gone" : false;
        }
        setStatus("Could not update For You. Try again.");
        return false;
      }
      const raw: unknown = await res.json().catch(() => ({}));
      const data = isRecord(raw) ? raw : {};
      const row = forYouSuggestions.find((item) => item.id === id);
      const next = (Array.isArray(data.suggestions) ? data.suggestions : [])
        .map(parseForYouSuggestion)
        .filter((item): item is ForYouSuggestion => Boolean(item));
      requestSeq.current.forYou++;
      setForYouSuggestions(
        next.length || path === "skip" || path === "dismiss"
          ? next
          : forYouSuggestions.filter((item) => item.id !== id),
      );
      historyStaleRef.current = true;
      if (path === "done" && row?.kind === "reply") armReplyPace();
      return true;
    } catch {
      setStatus("Could not update For You. Try again.");
      return false;
    } finally {
      setActionBusy(false);
    }
  }

  return {
    interactedIds,
    interactedHydrated,
    setInteractedIds,
    interactedHistory,
    interactedRetainedHistory,
    interactedTotal,
    interactedPage,
    changeInteractedPage: (page: number) => hydrateInteracted(preservedIdRef.current, page),
    pollInteracted,
    applyInteractedEvent,
    setInteractedHistory,
    dismissedHistory,
    // Local mutations supersede any snapshot already in flight.
    setDismissedHistory: (update: SetStateAction<DismissalHistoryEntry[]>) => {
      requestSeq.current.dismissed++;
      setDismissedHistory(update);
    },
    skippedHistory,
    setSkippedHistory: (update: SetStateAction<SkipHistoryEntry[]>) => {
      requestSeq.current.skipped++;
      setSkippedHistory(update);
    },
    expiredHistory,
    setExpiredHistory,
    forYouSuggestions,
    forYouProgress,
    forYouExtra,
    dismissedIdsRef,
    skippedIdsRef,
    expiredIdsRef,
    interactedIdsRef,
    blockedConversationsRef,
    historyStaleRef,
    applyHistoryFromBoot,
    hydrateInteracted,
    hydrateSkipped,
    hydrateDismissed,
    hydrateExpired,
    hydrateForYou,
    isHiddenFromCurated,
    keepInCurated,
    actForYou,
  };
}
