import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useSession } from "../auth/session";
import type { AuthSessionUser } from "../auth/types";
import type { BillingMe } from "../BillingPanel";
import type { LastScoutPayload } from "../lib/deskBoot";
import { apiFetch } from "../lib/apiBase";
import { deskNeedsXLink } from "../lib/deskGate";
import {
  brandedScoutLine,
  formatScoutFailure,
  isScoutGateError,
  isScoutStageId,
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
  pollingEnabled: boolean;
  agenda: string;
  settings: AppSettings;
  authUser: AuthSessionUser | null;
  billing: BillingMe | null;
  threadCount: number;
  setThreads: Dispatch<SetStateAction<ThreadCard[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
  keepInCurated: (thread: ThreadCard) => boolean;
  hydrateInteracted: () => Promise<void>;
  loadBilling: () => Promise<void>;
  hydrateAuth: () => Promise<AuthSessionUser | null>;
  onScoutFinished?: () => void;
};

export function useScoutRun({
  pollingEnabled,
  agenda,
  settings,
  authUser,
  billing,
  threadCount,
  setThreads,
  setStatus,
  keepInCurated,
  hydrateInteracted,
  loadBilling,
  hydrateAuth,
  onScoutFinished,
}: ScoutRunDeps) {
  const session = useSession();
  const [searching, setSearching] = useState(false);
  const [scoutStage, setScoutStage] = useState<ScoutStageId | null>(null);
  const [scoutLine, setScoutLine] = useState("");
  const [searchCooldownUntil, setSearchCooldownUntil] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const searchingRef = useRef(0);
  const staleHydration = useRef(false);
  const [watchTank, setWatchTank] = useState(false);
  const previousThreadCount = useRef(threadCount);

  function lastScoutUrl(autoStart = false): string {
    return `/api/scout/last?dedupeAccounts=${settings.dedupeAccounts}&autoStart=${autoStart ? 1 : 0}`;
  }

  const searchCooldownRemaining = Math.max(
    0,
    Math.ceil((searchCooldownUntil - nowMs) / 1000),
  );
  const grounded =
    billing?.sorties != null && billing.sorties.can_fly === false;

  function applyScoutEvent(ev: ScoutStreamEvent) {
    const stage = isScoutStageId(ev.stage) ? ev.stage : "planning";
    setScoutStage(stage);
    setScoutLine(
      brandedScoutLine({
        stage,
        candidates: ev.candidates,
        bucketSize: ev.bucketSize,
        coolCount: ev.coolCount,
        targetCool: ev.targetCool,
      }),
    );
    if (stage === "error") {
      setStatus(ev.message || scoutStageMessage(stage));
    }
  }

  function applyServerFlight(data: LastScoutPayload) {
    const flight = data.flight;
    setSearching(flight?.active === true);
    if (flight?.active) {
      const raw = flight.stage ?? undefined;
      const stage = isScoutStageId(raw) ? raw : "searching";
      setScoutStage(stage);
      setScoutLine(scoutStageMessage(stage));
      setWatchTank(true);
      return;
    }
    setScoutStage(null);
    setScoutLine("");
    setWatchTank(data.empty === true || (data.snapshot?.threads.length ?? 0) <= 1);
  }

  function applyLastScoutFromBoot(data: LastScoutPayload) {
    if (staleHydration.current) return;
    if (!data.ok) return;
    applyServerFlight(data);
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

  async function hydrateLastScout(autoStart = false, signal?: AbortSignal, generation = session.capture()) {
    const current = () => session.isCurrent(generation) && !signal?.aborted;
    if (!current()) return;
    try {
      const res = await apiFetch(lastScoutUrl(autoStart), { signal });
      if (!current()) return;
      if (res.status === 401) {
        session.invalidate("Your session has ended.");
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as LastScoutPayload;
      if (!current()) return;
      applyLastScoutFromBoot(data);
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
    setScoutStage("planning");
    setScoutLine(scoutStageMessage("planning"));

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
            lastScoutUrl(),
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
        staleHydration.current = false;
        const until = Date.now() + SEARCH_COOLDOWN_MS;
        searchingRef.current = until;
        setSearching(false);
        setScoutStage(null);
        setScoutLine("");
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
    const drained = previousThreadCount.current > 1 && threadCount <= 1;
    previousThreadCount.current = threadCount;
    if (drained) setWatchTank(true);
  }, [threadCount]);

  useEffect(() => {
    const generation = session.capture();
    if (!pollingEnabled || !watchTank || !session.isCurrent(generation)) return;
    const controller = new AbortController();
    let pending = false;
    const poll = async () => {
      if (pending || controller.signal.aborted || !session.isCurrent(generation)) return;
      pending = true;
      try {
        await hydrateLastScout(true, AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]), generation);
      } finally {
        pending = false;
      }
    };
    const id = window.setInterval(() => { void poll(); }, 4000);
    const stop = () => {
      controller.abort();
      window.clearInterval(id);
    };
    const unsubscribe = session.subscribe(() => {
      if (!session.isCurrent(generation)) stop();
    });
    void poll();
    return () => { stop(); unsubscribe(); };
  }, [pollingEnabled, watchTank, settings.dedupeAccounts, session]);

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
    scoutStage,
    scoutLine,
    searchCooldownRemaining,
    grounded,
    onSearch,
    applyLastScoutFromBoot,
    hydrateLastScout,
  };
}
