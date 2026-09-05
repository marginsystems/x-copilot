import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { apiFetch } from "../lib/apiBase";
import type { DeskBootDesk } from "../lib/deskBoot";
import { peekDeskBootCache } from "../lib/deskBoot";
import {
  parseForYouExtra,
  parseForYouProgress,
  parseForYouSuggestion,
  type ForYouExtraUsage,
  type ForYouProgress,
  type ForYouSuggestion,
} from "../lib/forYou";
import {
  keepPlainTextThread,
  threadHasExcludedTag,
  type AppSettings,
} from "../lib/settings";
import { armReplyPace } from "./replyPaceStore";
import { threadHasExcludedAuthor } from "./threadHelpers";
import type {
  DismissalHistoryEntry,
  ExpiredHistoryEntry,
  InteractionHistoryEntry,
  SkipHistoryEntry,
  ThreadCard,
} from "./types";

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
 * the phone lands as `discovered` while the desk tab is hidden; one fetch on
 * return is enough — no polling.
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
};

export function keepByMinViews(
  thread: Pick<
    ThreadCard,
    "isReply" | "inReplyToId" | "opViews" | "opParentDerived" | "views"
  >,
  settings: Pick<AppSettings, "filterByMinViews" | "minViews">,
): boolean {
  if (!settings.filterByMinViews) return true;
  const unknownReplyViews =
    (thread.isReply === true || Boolean(thread.inReplyToId)) &&
    (typeof thread.opViews !== "number" ||
      !Number.isFinite(thread.opViews) ||
      !thread.opParentDerived);
  if (unknownReplyViews) return true;
  const n = thread.opViews ?? thread.views;
  const views = typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
  return views >= settings.minViews;
}

export function useDeskHistory(deps: DeskHistoryDeps) {
  const { setThreads, setStatus, setActionBusy, settings } = deps;
  const { excludedTags, excludedAccounts } = settings;

  const seed = peekDeskBootCache()?.desk ?? null;
  const [interactedIds, setInteractedIds] = useState<Set<string>>(
    () => new Set(seed?.interacted.activeIds ?? []),
  );
  const [interactedHistory, setInteractedHistory] = useState<
    InteractionHistoryEntry[]
  >(() => seed?.interacted.interactions ?? []);
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

  function applyHistoryFromBoot(desk: DeskBootDesk) {
    if (historyStaleRef.current) return;
    setInteractedHistory(desk.interacted.interactions);
    const ids = new Set(desk.interacted.activeIds);
    interactedIdsRef.current = ids;
    setInteractedIds(ids);
    setDismissedHistory(desk.dismissed.dismissals);
    dismissedIdsRef.current = new Set(desk.dismissed.dismissedIds);
    setSkippedHistory(desk.skipped.skipped);
    skippedIdsRef.current = new Set(desk.skipped.skippedIds);
    setExpiredHistory(desk.expired.expired);
    expiredIdsRef.current = new Set(desk.expired.expiredIds);
    blockedConversationsRef.current = new Set([
      ...blockedFromHistory(desk.interacted.interactions),
      ...blockedFromHistory(desk.dismissed.dismissals),
      ...blockedFromHistory(desk.skipped.skipped),
    ]);
    setForYouSuggestions(desk.forYou.suggestions);
    setForYouProgress(desk.forYou.progress);
    setForYouExtra(desk.forYou.extra);
    setThreads((prev) => prev.filter((t) => keepInCurated(t)));
  }

  async function hydrateInteracted() {
    try {
      const res = await apiFetch("/api/interacted");
      if (!res.ok) return;
      const data = (await res.json()) as {
        interactions?: InteractionHistoryEntry[];
        activeIds?: string[];
      };
      const history = (data.interactions ?? []).filter(
        (i) =>
          i &&
          typeof i.threadId === "string" &&
          typeof i.author === "string" &&
          typeof i.at === "string",
      );
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
        setThreads((prev) => prev.filter((t) => keepInCurated(t)));
      }
    } catch {
      // Sidecar may be offline on first paint — ignore.
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
    const blocked = blockedConversationsRef.current;
    if (
      isHiddenFromCurated(thread.id) ||
      blocked.has(thread.id) ||
      (thread.conversationId && blocked.has(thread.conversationId)) ||
      (thread.inReplyToId && blocked.has(thread.inReplyToId)) ||
      threadHasExcludedTag(thread, excludedTags) ||
      threadHasExcludedAuthor(thread, excludedAccounts)
    ) {
      return false;
    }
    return (
      keepPlainTextThread(thread, settings) && keepByMinViews(thread, settings)
    );
  }

  async function hydrateSkipped() {
    try {
      const res = await apiFetch("/api/skipped");
      if (!res.ok) return;
      const data = (await res.json()) as {
        skipped?: SkipHistoryEntry[];
        skippedIds?: string[];
      };
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
    } catch {
      // Sidecar may be offline on first paint — ignore.
    }
  }

  async function hydrateDismissed() {
    try {
      const res = await apiFetch("/api/dismissed");
      if (!res.ok) return;
      const data = (await res.json()) as {
        dismissals?: DismissalHistoryEntry[];
        dismissedIds?: string[];
      };
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
    } catch {
      // Sidecar may be offline on first paint — ignore.
    }
  }

  async function hydrateExpired() {
    try {
      const res = await apiFetch("/api/expired");
      if (!res.ok) return;
      const data = (await res.json()) as {
        expired?: ExpiredHistoryEntry[];
        expiredIds?: string[];
      };
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
      // Sidecar may be offline on first paint — ignore.
    }
  }

  async function hydrateForYou() {
    try {
      const res = await apiFetch("/api/for-you");
      if (!res.ok) return;
      const data = (await res.json()) as { suggestions?: unknown[] };
      const rows = (Array.isArray(data.suggestions) ? data.suggestions : [])
        .map(parseForYouSuggestion)
        .filter((row): row is ForYouSuggestion => Boolean(row));
      setForYouSuggestions(rows);
      setForYouProgress(parseForYouProgress(data));
      setForYouExtra(parseForYouExtra(data));
    } catch {
      /* sidecar may be offline */
    }
  }

  async function actForYou(
    id: string,
    path: "done" | "skip" | "dismiss",
  ): Promise<boolean> {
    setActionBusy(true);
    try {
      const res = await apiFetch(`/api/for-you/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        if (res.status === 404) {
          setForYouSuggestions((prev) => prev.filter((row) => row.id !== id));
          historyStaleRef.current = true;
          if (path === "skip" || path === "dismiss") {
            await hydrateForYou();
          }
          return false;
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
      setForYouSuggestions(
        next.length || path === "skip" || path === "dismiss"
          ? next
          : forYouSuggestions.filter((item) => item.id !== id),
      );
      historyStaleRef.current = true;
      if (path === "skip" || path === "dismiss") {
        void hydrateForYou();
      }
      if (path === "done" && row?.kind === "reply") armReplyPace();
      return true;
    } catch {
      setStatus("Could not update For You. Try again.");
      return false;
    } finally {
      setActionBusy(false);
    }
  }

  async function requestExtra() {
    setActionBusy(true);
    try {
      const res = await apiFetch("/api/for-you/extra", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        suggestions?: unknown[];
      };
      const extra = parseForYouExtra(data);
      if (extra) setForYouExtra(extra);
      if (!res.ok) {
        setStatus("Could not update Approach. Try again.");
        return;
      }
      const rows = (Array.isArray(data.suggestions) ? data.suggestions : [])
        .map(parseForYouSuggestion)
        .filter((row): row is ForYouSuggestion => Boolean(row));
      setForYouSuggestions((prev) => {
        const seen = new Set(prev.map((row) => row.id));
        return [...rows.filter((row) => !seen.has(row.id)), ...prev];
      });
      historyStaleRef.current = true;
    } catch {
      setStatus("Could not update Approach. Try again.");
    } finally {
      setActionBusy(false);
    }
  }

  return {
    interactedIds,
    setInteractedIds,
    interactedHistory,
    setInteractedHistory,
    dismissedHistory,
    setDismissedHistory,
    skippedHistory,
    setSkippedHistory,
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
    requestExtra,
  };
}
