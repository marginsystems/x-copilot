import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AuthSessionUser } from "../auth/types";
import type { BillingMe } from "../BillingPanel";
import { apiFetch } from "../lib/apiBase";
import { deskNeedsXLink } from "../lib/deskGate";
import {
  SCOUT_SEARCH_TIMELINE,
  SCOUT_STAGE_RANK,
  SCOUT_STAGE_TICK_MS,
  formatScoutFailure,
  isScoutGateError,
  scoutFlightLine,
  scoutStageMessage,
  type ScoutStageId,
} from "../lib/scoutStages";
import {
  DEFAULT_SETTINGS,
  DEFAULT_TARGET_COOL_THREADS,
  type AppSettings,
} from "../lib/settings";
import { formatAbsoluteTime, formatTimeAgo } from "../lib/timeAgo";
import {
  appendThreadsById,
  coolProgressLabel,
  scoutProgressPrefix,
} from "./threadHelpers";
import type { ScoutLogEntry, ScoutStreamEvent, ThreadCard } from "./types";
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
  setExpandedId: Dispatch<SetStateAction<string | null>>;
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
  setExpandedId,
  keepInCurated,
  hydrateInteracted,
  loadBilling,
  hydrateAuth,
  onScoutFinished,
}: ScoutRunDeps) {
  const [searching, setSearching] = useState(false);
  const [scoutLog, setScoutLog] = useState<ScoutLogEntry[]>([]);
  const [searchCooldownUntil, setSearchCooldownUntil] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const searchingRef = useRef(0);
  const coolProgressRef = useRef({
    cool: 0,
    target: DEFAULT_SETTINGS.targetCoolThreads,
  });
  const flightStageRef = useRef<ScoutStageId>("planning");
  const serverStageRef = useRef<ScoutStageId | null>(null);
  const lastFlightCountsRef = useRef<{
    candidates?: number;
    bucketSize?: number;
  }>({});
  const staleHydration = useRef(false);

  const searchCooldownRemaining = Math.max(
    0,
    Math.ceil((searchCooldownUntil - nowMs) / 1000),
  );
  const sortiesLeft = billing?.sorties?.remaining;
  const sortiesLimit = billing?.sorties?.limit;
  const grounded =
    billing?.sorties != null && billing.sorties.can_fly === false;
  const searchBlocked =
    searching ||
    searchCooldownRemaining > 0 ||
    grounded ||
    deskNeedsXLink(authUser);

  function pushScoutLine(line: string, stage?: string) {
    const message = line.trim();
    if (!message) return;
    const atMs = Date.now();
    const entry: ScoutLogEntry = {
      at: new Date(atMs).toISOString(),
      message,
      ...(stage ? { stage } : {}),
    };
    setNowMs(atMs);
    setScoutLog((prev) => {
      const last = prev[prev.length - 1];
      if (last?.message === message) {
        const bumped = [...prev];
        bumped[bumped.length - 1] = {
          ...last,
          at: entry.at,
          ...(stage ? { stage } : {}),
        };
        return bumped;
      }
      return [...prev, entry].slice(-1000);
    });
    void apiFetch("/api/scout/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }).catch(() => {
      /* sidecar may be offline — keep in-memory */
    });
  }

  function applyScoutEvent(ev: ScoutStreamEvent) {
    const stage = (ev.stage ?? "planning") as ScoutStageId;
    if (typeof ev.coolCount === "number" && ev.coolCount > 0) {
      coolProgressRef.current.cool = ev.coolCount;
    }
    if (typeof ev.targetCool === "number") {
      coolProgressRef.current.target = ev.targetCool;
    }
    let message = ev.message || scoutStageMessage(stage);
    // Prefer server bucket copy; avoid double-prefixing Cand./Cool lines.
    if (
      !/^Cand\.?\b/i.test(message) &&
      !/^Candidates\b/i.test(message) &&
      !/^Cool\b/i.test(message) &&
      !/^0 cool/i.test(message)
    ) {
      const prefix = scoutProgressPrefix(ev);
      if (
        prefix &&
        (stage === "searching" ||
          stage === "filtering" ||
          stage === "triaging" ||
          stage === "partial")
      ) {
        message = `${prefix} · ${message}`;
      }
    }
    const counts = {
      cool: coolProgressRef.current.cool,
      target: coolProgressRef.current.target,
      candidates: ev.candidates ?? lastFlightCountsRef.current.candidates,
      bucketSize: ev.bucketSize ?? lastFlightCountsRef.current.bucketSize,
    };
    if (typeof ev.candidates === "number") {
      lastFlightCountsRef.current.candidates = ev.candidates;
    }
    if (typeof ev.bucketSize === "number") {
      lastFlightCountsRef.current.bucketSize = ev.bucketSize;
    }
    serverStageRef.current = stage;
    const incomingRank = SCOUT_STAGE_RANK[stage];
    const shownRank = SCOUT_STAGE_RANK[flightStageRef.current];
    const shownStage =
      stage === "error" ||
      stage === "done" ||
      incomingRank >= shownRank
        ? stage
        : flightStageRef.current;
    flightStageRef.current = shownStage;
    setStatus(
      shownStage === "error"
        ? message
        : scoutFlightLine(shownStage, counts),
    );
    pushScoutLine(message, stage);
  }

  async function hydrateScoutLog() {
    try {
      const res = await apiFetch("/api/scout/log");
      if (!res.ok) return;
      const data = (await res.json()) as { entries?: ScoutLogEntry[] };
      const entries = Array.isArray(data.entries)
        ? data.entries.filter(
            (e) =>
              e &&
              typeof e.message === "string" &&
              typeof e.at === "string",
          )
        : [];
      setScoutLog((prev) =>
        prev.length > 0 ? prev : entries.slice(-1000),
      );
    } catch {
      /* ignore */
    }
  }

  function onStopScout() {
    abortRef.current?.abort();
  }

  async function hydrateLastScout() {
    try {
      const res = await apiFetch(`/api/scout/last?dedupeAccounts=${settings.dedupeAccounts}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok?: boolean;
        empty?: boolean;
        snapshot?: {
          savedAt: string;
          queries?: string[];
          threads?: ThreadCard[];
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
      };
      if (!data.ok || data.empty || !data.snapshot) return;
      if (staleHydration.current) return;
      const list = Array.isArray(data.snapshot.threads)
        ? data.snapshot.threads
        : [];
      const filtered = list.filter((t) => keepInCurated(t));
      setThreads(filtered);
      watchDeskThreads(filtered);
      const when =
        formatAbsoluteTime(data.snapshot.savedAt) ||
        formatTimeAgo(data.snapshot.savedAt) ||
        "earlier";
      const pc = data.snapshot.pipelineCounts;
      const funnel = pc
        ? ` (${[
            pc.raw,
            pc.afterDedupe,
            pc.afterCooldown,
            ...(typeof pc.afterSelfReply === "number" ? [pc.afterSelfReply] : []),
            ...(typeof pc.afterLinks === "number" ? [pc.afterLinks] : []),
            pc.afterLength,
            pc.afterTriage,
          ].join(" → ")})`
        : "";
      setStatus(
        `Restored ${filtered.length} threads${funnel} from ${when}.`,
      );
    } catch {
      // Sidecar may be offline on first paint — ignore.
    }
  }

  async function onSearch() {
    if (deskNeedsXLink(authUser)) {
      const line = formatScoutFailure(
        "Link X with the official login before Take off.",
        { soft: true },
      );
      setStatus(line);
      pushScoutLine(line, "error");
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
        pushScoutLine(line, "error");
      }
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    searchingRef.current = Infinity;
    staleHydration.current = true;

    const targetCool = DEFAULT_TARGET_COOL_THREADS;
    coolProgressRef.current = { cool: 0, target: targetCool };
    flightStageRef.current = "planning";
    serverStageRef.current = null;
    lastFlightCountsRef.current = {};

    setSearching(true);
    // Keep existing thread rows; partials + done append by id across runs.
    setExpandedId(null);
    pushScoutLine("── Take off ──", "planning");
    applyScoutEvent({
      stage: "planning",
      message: scoutStageMessage("planning"),
      coolCount: 0,
      targetCool,
    });

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
            dropEmDashes: settings.dropEmDashes,
            dropAutomatedAccounts: settings.dropAutomatedAccounts,
            dedupeAccounts: settings.dedupeAccounts,
            preferredLanguage: settings.preferredLanguage,
            excludedTags: settings.excludedTags,
            excludedAccounts: settings.excludedAccounts,
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
        pushScoutLine(line, "error");
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
        const qs = doneEvent.queries ?? [];
        const list = doneEvent.threads ?? [];
        const incoming = list.filter((t) => keepInCurated(t));
        watchDeskThreads(incoming);
        // Append this run’s cool threads; do not wipe prior Scout loops.
        setThreads((prev) => appendThreadsById(prev, incoming));
        setExpandedId(null);
        await hydrateInteracted();
        const progress = coolProgressLabel(
          doneEvent.coolCount ?? list.length,
          doneEvent.targetCool ?? targetCool,
          targetCool,
        );
        const reason = doneEvent.stopReason
          ? ` · stop: ${doneEvent.stopReason}`
          : "";
        const qLabel = qs.length ? qs.map((q) => `"${q}"`).join(", ") : "(none)";
        const summary =
          `${progress}${reason} — ${qLabel}` +
          (doneEvent.triageWarning ? ` · ${doneEvent.triageWarning}` : "") +
          (doneEvent.cooldownWarning ? ` · ${doneEvent.cooldownWarning}` : "") +
          (doneEvent.linkWarning ? ` · ${doneEvent.linkWarning}` : "") +
          (doneEvent.emDashWarning ? ` · ${doneEvent.emDashWarning}` : "") +
          (doneEvent.automatedWarning ? ` · ${doneEvent.automatedWarning}` : "") +
          (doneEvent.excludedAccountWarning
            ? ` · ${doneEvent.excludedAccountWarning}`
            : "") +
          (doneEvent.lengthWarning ? ` · ${doneEvent.lengthWarning}` : "");
        setStatus(scoutStageMessage("done"));
        pushScoutLine(summary);
      } else if (!stream.sawError) {
        const line = formatScoutFailure("stream ended without results");
        setStatus(line);
        pushScoutLine(line, "error");
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
        const { cool, target } = coolProgressRef.current;
        const summary = `Cool ${cool}/${target} · stop: aborted`;
        setStatus(scoutStageMessage("done"));
        pushScoutLine(summary);
      } else {
        const line = formatScoutFailure(
          "Sidecar offline — run ./pm2-manager.sh restart or npm run dev:server",
        );
        setStatus(line);
        pushScoutLine(line, "error");
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
            prev.startsWith("Sidecar offline") ||
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

  useEffect(() => {
    if (!searching) return;
    let tick = 0;
    const id = window.setInterval(() => {
      tick += 1;
      const nextIdx = Math.min(tick, SCOUT_SEARCH_TIMELINE.length - 1);
      const next = SCOUT_SEARCH_TIMELINE[nextIdx];
      if (!next) return;
      const server = serverStageRef.current;
      if (server && SCOUT_STAGE_RANK[server] >= SCOUT_STAGE_RANK[next]) {
        return;
      }
      if (SCOUT_STAGE_RANK[next] <= SCOUT_STAGE_RANK[flightStageRef.current]) {
        return;
      }
      flightStageRef.current = next;
      setStatus(
        scoutFlightLine(next, {
          cool: coolProgressRef.current.cool,
          target: coolProgressRef.current.target,
          ...lastFlightCountsRef.current,
        }),
      );
    }, SCOUT_STAGE_TICK_MS);
    return () => window.clearInterval(id);
  }, [searching]);

  // Keep scout-log / cooldown "time ago" labels fresh (1s while live or logged).
  useEffect(() => {
    if (!searching && scoutLog.length === 0) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [searching, scoutLog.length > 0]);

  return {
    searching,
    scoutLog,
    searchCooldownRemaining,
    searchBlocked,
    grounded,
    sortiesLeft,
    sortiesLimit,
    flightStageRef,
    staleHydration,
    onSearch,
    onStopScout,
    hydrateLastScout,
    hydrateScoutLog,
    pushScoutLine,
  };
}
