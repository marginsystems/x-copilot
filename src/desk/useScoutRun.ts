import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AuthSessionUser } from "../auth/types";
import type { BillingMe } from "../BillingPanel";
import type { LastScoutPayload } from "../lib/deskBoot";
import { apiFetch } from "../lib/apiBase";
import { deskNeedsXLink } from "../lib/deskGate";
import {
  formatScoutFailure,
  isScoutGateError,
  scoutStageMessage,
  type ScoutStageId,
} from "../lib/scoutStages";
import {
  DEFAULT_TARGET_COOL_THREADS,
  type AppSettings,
} from "../lib/settings";
import { appendThreadsById } from "./threadHelpers";
import type { ScoutStreamEvent, ThreadCard } from "./types";
import { watchDeskThreads } from "./watch";

/** Hard-filter candidate bucket size sent on each Scout run. */
export const SCOUT_BUCKET_SIZE = 20;

/** Matches server SCOUT_COOLDOWN_MS — one Search every 15s after a run ends. */
export const SEARCH_COOLDOWN_MS = 15_000;

export type ScoutRunDeps = {
  agenda: string;
  settings: AppSettings;
  authUser: AuthSessionUser | null;
  billing: BillingMe | null;
  setThreads: Dispatch<SetStateAction<ThreadCard[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
  keepInCurated: (thread: ThreadCard) => boolean;
  hydrateInteracted: () => Promise<void>;
  loadBilling: () => Promise<void>;
  hydrateAuth: () => Promise<AuthSessionUser | null>;
  onScoutFinished?: () => void;
};

export function useScoutRun({
  agenda,
  settings,
  authUser,
  billing,
  setThreads,
  setStatus,
  keepInCurated,
  hydrateInteracted,
  loadBilling,
  hydrateAuth,
  onScoutFinished,
}: ScoutRunDeps) {
  const [searching, setSearching] = useState(false);
  const [searchCooldownUntil, setSearchCooldownUntil] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const searchingRef = useRef(0);
  const staleHydration = useRef(false);

  const searchCooldownRemaining = Math.max(
    0,
    Math.ceil((searchCooldownUntil - nowMs) / 1000),
  );
  const grounded =
    billing?.sorties != null && billing.sorties.can_fly === false;

  function applyScoutEvent(ev: ScoutStreamEvent) {
    const stage = (ev.stage ?? "planning") as ScoutStageId;
    if (stage === "error") {
      setStatus(ev.message || scoutStageMessage(stage));
    }
  }

  function applyLastScoutFromBoot(data: LastScoutPayload) {
    if (staleHydration.current) return;
    if (!data.ok) return;
    if (data.empty || !data.snapshot) {
      setThreads([]);
      return;
    }
    const list = Array.isArray(data.snapshot.threads)
      ? data.snapshot.threads
      : [];
    const filtered = list.filter((t) => keepInCurated(t));
    setThreads(filtered);
    watchDeskThreads(filtered);
  }

  async function hydrateLastScout() {
    try {
      const res = await apiFetch(`/api/scout/last?dedupeAccounts=${settings.dedupeAccounts}`);
      if (!res.ok) return;
      applyLastScoutFromBoot((await res.json()) as LastScoutPayload);
    } catch {
      // Sidecar may be offline on first paint — ignore.
    }
  }

  async function onSearch() {
    if (deskNeedsXLink(authUser)) {
      const line = formatScoutFailure(
        "Link X with the official login before Scout can refuel.",
        { soft: true },
      );
      setStatus(line);
      return;
    }
    if (Date.now() < searchingRef.current) {
      if (isFinite(searchingRef.current)) {
        const waitSec = Math.ceil((searchingRef.current - Date.now()) / 1000);
        const line = formatScoutFailure(
          `Wait ${waitSec}s before starting Scout again.`,
          { soft: true },
        );
        setStatus(line);
      }
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    searchingRef.current = Infinity;
    staleHydration.current = true;

    const targetCool = DEFAULT_TARGET_COOL_THREADS;

    setSearching(true);
    // Drop leftover wait / failure copy so a clean landing does not keep it.
    setStatus("");
    // Keep existing thread rows; partials + done append by id across runs.

    try {
      const res = await apiFetch("/api/scout/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({
          agenda,
          targetCool,
          bucketSize: SCOUT_BUCKET_SIZE,
          filters: {
            maxThreadChars: settings.maxThreadChars,
            dropArticles: settings.dropArticles,
            dropOutboundLinks: settings.dropOutboundLinks,
            dropNativeMedia: settings.dropNativeMedia,
            dropHashtags: settings.dropHashtags,
            dropEmDashes: settings.dropEmDashes,
            dropProfanity: settings.dropProfanity,
            dropAutomatedAccounts: settings.dropAutomatedAccounts,
            filterByMinViews: settings.filterByMinViews,
            minViews: settings.minViews,
            dedupeAccounts: settings.dedupeAccounts,
            preferredLanguage: settings.preferredLanguage,
            excludedTags: settings.excludedTags,
            excludedAccounts: settings.excludedAccounts,
            avoidPrompt: settings.avoidPrompt,
          },
        }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const fallback = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        if (fallback.error === "x_link_required") {
          await hydrateAuth();
        }
        const detail =
          fallback.message ||
          fallback.error ||
          (!res.body ? "empty response body" : `HTTP ${res.status}`);
        const soft = isScoutGateError(res.status, fallback);
        const line = formatScoutFailure(detail, { soft });
        setStatus(line);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const stream = {
        doneEvent: null as ScoutStreamEvent | null,
        sawError: false,
      };

      const handleEvent = (ev: ScoutStreamEvent) => {
        if (ev.stage === "done") {
          stream.doneEvent = ev;
          applyScoutEvent(ev);
          onScoutFinished?.();
          return;
        }
        if (ev.stage === "error") {
          applyScoutEvent(ev);
          stream.sawError = true;
          return;
        }
        applyScoutEvent(ev);
        if (ev.stage === "partial" && ev.threads?.length) {
          const incoming = (ev.threads ?? []).filter((t) => keepInCurated(t));
          watchDeskThreads(incoming);
          setThreads((prev) => appendThreadsById(prev, incoming));
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let ev: ScoutStreamEvent;
          try {
            ev = JSON.parse(trimmed) as ScoutStreamEvent;
          } catch {
            continue;
          }
          handleEvent(ev);
        }
      }

      if (buffer.trim()) {
        try {
          handleEvent(JSON.parse(buffer.trim()) as ScoutStreamEvent);
        } catch {
          /* ignore trailing junk */
        }
      }

      if (stream.doneEvent) {
        const doneEvent = stream.doneEvent;
        const list = doneEvent.threads ?? [];
        const incoming = list.filter((t) => keepInCurated(t));
        watchDeskThreads(incoming);
        // Append this run’s cool threads; do not wipe prior Scout loops.
        setThreads((prev) => appendThreadsById(prev, incoming));
        staleHydration.current = false;
        await hydrateLastScout();
        await hydrateInteracted();
      } else if (!stream.sawError) {
        const line = formatScoutFailure("stream ended without results");
        setStatus(line);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Keep partials already in state; merge any cools persisted mid-run.
        try {
          const res = await apiFetch(
            `/api/scout/last?dedupeAccounts=${settings.dedupeAccounts}`,
          );
          if (res.ok) {
            const data = (await res.json()) as {
              ok?: boolean;
              empty?: boolean;
              snapshot?: { threads?: ThreadCard[]; queries?: string[] };
            };
            if (data.ok && !data.empty && data.snapshot?.threads?.length) {
              setThreads((prev) =>
                appendThreadsById(
                  prev,
                  data.snapshot!.threads!.filter((t) => keepInCurated(t)),
                ),
              );
            }
          }
        } catch {
          /* sidecar may be offline — keep in-memory cools */
        }
        // Still cool down in finally so Stop / unmount cannot bypass the gate.
        onScoutFinished?.();
      } else {
        const line = formatScoutFailure("Scout service unavailable");
        setStatus(line);
        onScoutFinished?.();
      }
    } finally {
      if (abortRef.current === ac) {
        const until = Date.now() + SEARCH_COOLDOWN_MS;
        searchingRef.current = until;
        setSearching(false);
        setSearchCooldownUntil(until);
        setNowMs(Date.now());
        void loadBilling();
        setStatus((prev) => {
          if (/^Wait \d+s before (starting Scout|searching) again/.test(prev)) {
            return prev;
          }
          if (/^Hold short/.test(prev) || /^Grounded/.test(prev)) {
            return prev;
          }
          if (
            prev.startsWith("Scout failed:") ||
            prev.startsWith("Scout is unavailable") ||
            prev.startsWith("Couldn't land") ||
            /^A Scout run is already in progress/.test(prev)
          ) {
            return `${prev} · Hold short ${Math.ceil(SEARCH_COOLDOWN_MS / 1000)}s.`;
          }
          return prev;
        });
      }
    }
  }

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (searchCooldownUntil <= Date.now()) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => {
      const t = Date.now();
      setNowMs(t);
      if (t >= searchCooldownUntil) {
        window.clearInterval(id);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [searchCooldownUntil]);

  return {
    searching,
    searchCooldownRemaining,
    grounded,
    onSearch,
    applyLastScoutFromBoot,
    hydrateLastScout,
  };
}
