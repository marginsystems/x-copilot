import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useSession } from "../auth/session";
import { parseDeskBoot, type LastScoutPayload } from "../lib/deskBoot";
import { apiFetch } from "../lib/apiBase";
import { isRecord } from "../lib/typeGuards";
import {
  isScoutStageId,
  scoutStageMessage,
  type ScoutStageId,
} from "../lib/scoutStages";
import type { AppSettings } from "../lib/settings";
import type { ThreadCard } from "./types";
import { watchDeskThreads } from "./watch";

const SCOUT_INFRA_STATUS = "Scout hit an infra error.";

export type ScoutRunDeps = {
  pollingEnabled: boolean;
  settings: AppSettings;
  threadCount: number;
  setThreads: Dispatch<SetStateAction<ThreadCard[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
  keepInCurated: (thread: ThreadCard) => boolean;
};

export function useScoutRun({
  pollingEnabled,
  settings,
  threadCount,
  setThreads,
  setStatus,
  keepInCurated,
}: ScoutRunDeps) {
  const session = useSession();
  const [searching, setSearching] = useState(false);
  const [scoutStage, setScoutStage] = useState<ScoutStageId | null>(null);
  const [scoutLine, setScoutLine] = useState("");
  const [watchTank, setWatchTank] = useState(false);
  const previousThreadCount = useRef(threadCount);

  function lastScoutUrl(autoStart = false): string {
    return `/api/scout/last?dedupeAccounts=${settings.dedupeAccounts}&autoStart=${autoStart ? 1 : 0}`;
  }

  function applyServerFlight(data: LastScoutPayload, tankFull: boolean) {
    const flight = data.flight;
    setSearching(flight?.active === true);
    if (flight?.active) {
      const raw = flight.stage ?? undefined;
      const stage = isScoutStageId(raw) ? raw : "searching";
      setScoutStage(stage);
      setScoutLine(scoutStageMessage(stage));
      setWatchTank(true);
      setStatus((prev) => (prev === SCOUT_INFRA_STATUS ? "" : prev));
      return;
    }
    setScoutStage(null);
    setScoutLine("");
    if (flight?.failure === true) {
      setStatus((prev) => {
        if (/^Wait \d+s before (starting Scout|searching) again/.test(prev)) {
          return prev;
        }
        if (prev.includes("Link X with the official login")) return prev;
        return SCOUT_INFRA_STATUS;
      });
    } else {
      setStatus((prev) => (prev === SCOUT_INFRA_STATUS ? "" : prev));
    }
    setWatchTank(!tankFull);
  }

  function applyLastScoutFromBoot(
    data: LastScoutPayload,
    tankFull = !data.empty && (data.snapshot?.threads.length ?? 0) > 1,
  ) {
    applyServerFlight(data, tankFull);
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
      const raw: unknown = await res.json();
      const data = parseDeskBoot({ ok: true, desk: { lastScout: raw } })?.desk?.lastScout;
      if (!current()) return;
      if (data) {
        const tankFull = isRecord(raw) && raw.empty !== true &&
          isRecord(raw.snapshot) && Array.isArray(raw.snapshot.threads) &&
          raw.snapshot.threads.length > 1;
        applyLastScoutFromBoot(data, tankFull);
      }
    } catch {
      // Sidecar may be offline on first paint — ignore.
    }
  }

  // The server refuels via autoStart polling; there is no manual client run.
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
      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      const timeoutId = window.setTimeout(abortRequest, 12000);
      if (controller.signal.aborted) requestController.abort();
      else controller.signal.addEventListener("abort", abortRequest, { once: true });
      try {
        await hydrateLastScout(true, requestController.signal, generation);
      } finally {
        window.clearTimeout(timeoutId);
        controller.signal.removeEventListener("abort", abortRequest);
        pending = false;
      }
    };
    const id = window.setInterval(() => { poll().catch((err: unknown) => console.error(err)); }, 4000);
    const stop = () => {
      controller.abort();
      window.clearInterval(id);
    };
    const unsubscribe = session.subscribe(() => {
      if (!session.isCurrent(generation)) stop();
    });
    poll().catch((err: unknown) => console.error(err));
    return () => { stop(); unsubscribe(); };
  }, [pollingEnabled, watchTank, settings.dedupeAccounts, session]);

  return {
    searching,
    scoutStage,
    scoutLine,
    applyLastScoutFromBoot,
    hydrateLastScout,
  };
}
