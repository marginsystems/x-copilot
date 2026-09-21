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
import { peekDeskBootCache } from "../lib/deskBoot";
import {
  parseForYouExtra,
  parseForYouProgress,
  parseForYouSuggestion,
  type ForYouExtraUsage,
  type ForYouProgress,
  type ForYouSuggestion,
} from "../lib/forYou";
import type { AppSettings } from "../lib/settings";
import { armReplyPace } from "./replyPaceStore";
import {
  parseInteractionHistoryEntry,
  type DismissalHistoryEntry,
  type ExpiredHistoryEntry,
  type InteractionHistoryEntry,
  type SkipHistoryEntry,
  type ThreadCard,
} from "./types";

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
      void refreshRef.current();
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
  const session = useSession();
  const requestSeq = useRef({
    interacted: 0, skipped: 0, dismissed: 0, expired: 0, forYou: 0,
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
      ...blockedFromHistory(seed?.interacted.interactions ?? []),
      ...blockedFromHistory(seed?.dismissed.dismissals ?? []),
      ...blockedFromHistory(seed?.skipped.skipped ?? []),
    ]),
  );
  /** Set once a user action mutates history locally; boot's server snapshot is then stale. */
  const historyStaleRef = useRef(false);
  const preservedIdRef = useRef<string | null>(null);

  function applyHistoryFromBoot(desk: DeskBootDeskPatch) {
    if (historyStaleRef.current) return;
    if (desk.interacted) {
      setInteractedHydrated(true);
      setInteractedHistory(desk.interacted.interactions);
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
        ...blockedFromHistory(desk.interacted.interactions),
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
  async function hydrateInteracted(preservedId?: string | null) {
    const isCurrent = beginRefresh("interacted");
    if (!isCurrent()) return;
    setInteractedHydrated(false);
    if (preservedId !== undefined) {
      const changed = preservedIdRef.current !== preservedId;
      preservedIdRef.current = preservedId;
      if (changed || preservedId === null) {
        setThreads((prev) => prev.filter((t) => keepInCurated(t)));
      }
    }
    try {
      const res = await apiFetch("/api/interacted");
      if (!isCurrent()) return;
      if (!res.ok) throw new Error("Refresh failed");
      const data = (await res.json()) as {
        interactions?: InteractionHistoryEntry[];
        activeIds?: string[];
      };
      if (!isCurrent()) return;
      const history = parseInteractedHistory(data.interactions);
      setInteractedHistory(history);
      const ids = new Set(
        (Array.isArray(data.activeIds) ? data.activeIds : []).filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      );
      interactedIdsRef.current = ids;
      setInteractedIds(ids);
      const blocked = new Set(blockedConversationsRef.current);
      for (const i of history) {
        const root =
          i.conversationId?.trim() ||
          i.inReplyToId?.trim() ||
          i.threadId.trim();
        if (root) blocked.add(root);
        if (i.threadId.trim()) blocked.add(i.threadId.trim());
        if (i.inReplyToId?.trim()) blocked.add(i.inReplyToId.trim());
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
      onHydrated?.("interacted");
    } catch {
      if (isCurrent()) setStatus("Could not refresh interacted history. Try again.");
    } finally {
      if (isCurrent()) setInteractedHydrated(true);
    }
  }

  useRehydrateOnVisible(hydrateInteracted);

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
      const data = (await res.json()) as {
        skipped?: SkipHistoryEntry[];
        skippedIds?: string[];
      };
      if (!isCurrent()) return;
      const history = (data.skipped ?? []).filter(
        (d) =>
          d &&
          typeof d.threadId === "string" &&
          typeof d.author === "string" &&
          typeof d.at === "string",
      );
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
      onHydrated?.("skipped");
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
      const data = (await res.json()) as {
        dismissals?: DismissalHistoryEntry[];
        dismissedIds?: string[];
      };
      if (!isCurrent()) return;
      const history = (data.dismissals ?? []).filter(
        (d) =>
          d &&
          typeof d.threadId === "string" &&
          typeof d.author === "string" &&
          typeof d.at === "string",
      );
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
      onHydrated?.("dismissed");
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
      const data = (await res.json()) as {
        expired?: ExpiredHistoryEntry[];
        expiredIds?: string[];
      };
      if (!isCurrent()) return;
      const history = (data.expired ?? []).filter(
        (e) =>
          e &&
          typeof e.threadId === "string" &&
          typeof e.author === "string" &&
          typeof e.at === "string",
      );
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
      const data = (await res.json()) as { suggestions?: unknown[] };
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
      const data = (await res.json().catch(() => ({}))) as {
        suggestions?: unknown[];
      };
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
