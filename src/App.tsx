import { useEffect, useRef, useState } from "react";
import {
  formatScoutFailure,
  isScoutGateError,
  scoutStageMessage,
  type ScoutStageId,
} from "./lib/scoutStages";
import {
  loadSettings,
  saveSettings,
  type AppSettings,
  clampMaxThreadChars,
  clampTargetCoolThreads,
  DEFAULT_SETTINGS,
} from "./lib/settings";
import { formatAbsoluteTime, formatTimeAgo } from "./lib/timeAgo";
import { sortThreadsByCreatedAtNewest } from "./lib/threadSort";

type ThreadCard = {
  id: string;
  author: string;
  text: string;
  url: string;
  createdAt?: string;
  summary?: string;
  /** 0–100, higher = more engagement bait. */
  baitScore?: number;
  flags?: string[];
  intent?: string;
  engage?: "skip" | "consider" | "priority";
  reason?: string;
  score?: number;
};

type ScoutStreamEvent = {
  agent?: string;
  stage?: ScoutStageId | string;
  message?: string;
  threads?: ThreadCard[];
  queries?: string[];
  coolCount?: number;
  targetCool?: number;
  stopReason?: "qualified" | "target" | "exhausted" | "aborted";
  candidates?: number;
  bucketSize?: number;
  triageWarning?: string;
  cooldownWarning?: string;
  lengthWarning?: string;
  pipelineCounts?: {
    raw: number;
    afterDedupe: number;
    afterCooldown: number;
    afterLength: number;
    afterTriage: number;
  };
};

type ScoutLogEntry = {
  at: string;
  message: string;
  stage?: string;
};

type ReplyStatSnapshot = {
  views?: number;
  likes?: number;
  replies?: number;
  retweets?: number;
  sampledAt: string;
};

type InteractionHistoryEntry = {
  threadId: string;
  author: string;
  at: string;
  url?: string;
  summary?: string;
  text?: string;
  replyId?: string;
  replyUrl?: string;
  postedAt?: string;
  stats?: {
    t1h?: ReplyStatSnapshot;
    t24h?: ReplyStatSnapshot;
  };
};

/** Keep in sync with server/src/interactionStore.ts parseStatusIdFromUrl. */
function parseStatusIdFromUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (
      host !== "x.com" &&
      host !== "twitter.com" &&
      host !== "mobile.twitter.com"
    ) {
      return null;
    }
    const m = u.pathname.match(/\/status(?:es)?\/(\d+)/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

type ThreadsTab = "curated" | "interacted";

const SCOUT_LOG_PAGE_SIZE = 100;

function normalizeAuthorKey(author: string): string {
  return author.trim().replace(/^@+/, "").toLowerCase();
}

function baitRisk(thread: ThreadCard): number | null {
  const value = thread.baitScore ?? thread.score;
  return typeof value === "number" ? value : null;
}

function baitClass(bait: number | null): string {
  if (bait === null) return "bait";
  if (bait >= 65) return "bait high";
  if (bait >= 35) return "bait mid";
  return "bait low";
}

function appendThreadsById(
  prev: ThreadCard[],
  next: ThreadCard[] | undefined,
): ThreadCard[] {
  if (!next?.length) return prev;
  const seen = new Set(prev.map((t) => t.id));
  const out = [...prev];
  for (const t of next) {
    if (!t.id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

function coolProgressLabel(
  coolCount: number | undefined,
  targetCool: number | undefined,
  fallbackTarget: number,
): string {
  const cool = typeof coolCount === "number" ? coolCount : 0;
  const target =
    typeof targetCool === "number" ? targetCool : fallbackTarget;
  return `Cool ${cool}/${target}`;
}

function scoutProgressPrefix(ev: {
  message?: string;
  candidates?: number;
  bucketSize?: number;
  coolCount?: number;
}): string | null {
  if (
    typeof ev.candidates === "number" &&
    typeof ev.bucketSize === "number" &&
    (ev.coolCount ?? 0) === 0
  ) {
    return `Candidates ${ev.candidates}/${ev.bucketSize}`;
  }
  if (typeof ev.coolCount === "number" && ev.coolCount > 0) {
    return `Cool ${ev.coolCount}`;
  }
  return null;
}

function ThreadRow({
  thread,
  open,
  busy,
  interacted,
  onToggle,
  onMark,
}: {
  thread: ThreadCard;
  open: boolean;
  busy: boolean;
  interacted: boolean;
  onToggle: () => void;
  onMark: () => void;
}) {
  const bait = baitRisk(thread);
  const ago = formatTimeAgo(thread.createdAt);
  const absolute = formatAbsoluteTime(thread.createdAt);
  const tags = [...new Set([thread.intent, ...(thread.flags ?? [])].filter(Boolean))];
  const classes = ["thread-row"];
  if (open) classes.push("open");
  if (thread.engage === "skip") classes.push("skip");

  return (
    <article className={classes.join(" ")}>
      <button
        type="button"
        className="row-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        {bait !== null ? (
          <span
            className={baitClass(bait)}
            title="Engagement-bait risk — higher is worse"
          >
            {bait}
          </span>
        ) : (
          <span className="bait" aria-hidden="true" />
        )}
        <span className="row-main">
          <span className="row-summary">{thread.summary ?? thread.text}</span>
          <span className="row-meta">
            <span>{thread.author}</span>
            {ago ? <span title={absolute ?? undefined}>{ago}</span> : null}
            {interacted ? (
              <span className="chip chip-interacted">interacted</span>
            ) : null}
            {bait !== null &&
            (thread.engage === "skip" || thread.engage === "priority") ? (
              <span className={`chip chip-${thread.engage}`}>
                {thread.engage}
              </span>
            ) : null}
          </span>
        </span>
        <span className="caret" aria-hidden="true">
          {open ? "–" : "+"}
        </span>
      </button>

      {open ? (
        <div className="row-detail">
          <p className="original">{thread.text}</p>
          {thread.reason ? <p className="reason">{thread.reason}</p> : null}
          {tags.length > 0 ? (
            <div className="tags">
              {tags.map((tag) => (
                <span className="tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          <div className="row">
            <a className="ghost" href={thread.url} target="_blank" rel="noreferrer">
              Open on X
            </a>
            <button
              className="primary"
              disabled={busy || interacted}
              onClick={onMark}
            >
              {interacted ? "Interacted" : "Mark interacted"}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function formatStatChip(
  label: string,
  snap: ReplyStatSnapshot | undefined,
  pending: boolean,
): string {
  if (snap) {
    const views =
      typeof snap.views === "number" ? snap.views.toLocaleString() : "—";
    const likes =
      typeof snap.likes === "number" ? snap.likes.toLocaleString() : "—";
    return `${label}: ${views} views · ${likes} likes`;
  }
  if (pending) return `${label}: pending`;
  return "";
}

function InteractedRow({
  entry,
}: {
  entry: InteractionHistoryEntry;
}) {
  const ago = formatTimeAgo(entry.at);
  const absolute = formatAbsoluteTime(entry.at);
  const blurb = entry.summary || entry.text || entry.threadId;
  const hasReply = Boolean(entry.replyId);
  const t1hLabel = formatStatChip("1h", entry.stats?.t1h, hasReply);
  const t24hLabel = formatStatChip("24h", entry.stats?.t24h, hasReply);
  const replyHref = entry.replyUrl;
  return (
    <article className="thread-row interacted-row">
      <div className="row-head static">
        <span className="bait" aria-hidden="true" />
        <span className="row-main">
          <span className="row-summary">{blurb}</span>
          <span className="row-meta">
            <span>{entry.author}</span>
            {ago ? <span title={absolute ?? undefined}>{ago}</span> : null}
            <span className="chip chip-interacted">interacted</span>
            {t1hLabel ? <span className="chip">{t1hLabel}</span> : null}
            {t24hLabel ? <span className="chip">{t24hLabel}</span> : null}
          </span>
        </span>
      </div>
      {entry.url || replyHref ? (
        <div className="row-detail compact">
          <div className="row">
            {entry.url ? (
              <a className="ghost" href={entry.url} target="_blank" rel="noreferrer">
                Open on X
              </a>
            ) : null}
            {replyHref ? (
              <a className="ghost" href={replyHref} target="_blank" rel="noreferrer">
                Open reply
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

type AppView = "dashboard" | "settings";

/** Matches server SCOUT_COOLDOWN_MS — one Search every 15s after a run ends. */
const SEARCH_COOLDOWN_MS = 15_000;

export default function App() {
  const [agenda, setAgenda] = useState(
    "Find builders talking about shipping AI tools in public. Prefer questions I can answer helpfully.",
  );
  const [status, setStatus] = useState(
    "Idle — verify session, then let Scout search from your agenda",
  );
  const [plannedQueries, setPlannedQueries] = useState<string[]>([]);
  const [threads, setThreads] = useState<ThreadCard[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [scoutStage, setScoutStage] = useState<ScoutStageId | null>(null);
  const [scoutLog, setScoutLog] = useState<ScoutLogEntry[]>([]);
  const [scoutLogPage, setScoutLogPage] = useState(0);
  const [interactedIds, setInteractedIds] = useState<Set<string>>(() => new Set());
  const [interactedHistory, setInteractedHistory] = useState<
    InteractionHistoryEntry[]
  >([]);
  const [threadsTab, setThreadsTab] = useState<ThreadsTab>("curated");
  const [view, setView] = useState<AppView>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuEntered, setMenuEntered] = useState(false);
  const [sessionUser, setSessionUser] = useState<{
    screen_name: string;
    name: string;
  } | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(() =>
    loadSettings(),
  );
  const [settingsStatus, setSettingsStatus] = useState("");
  const [searchCooldownUntil, setSearchCooldownUntil] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [markThread, setMarkThread] = useState<ThreadCard | null>(null);
  const [markReplyUrl, setMarkReplyUrl] = useState("");
  const [markReply, setMarkReply] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const searchingRef = useRef(0);
  const coolProgressRef = useRef({
    cool: 0,
    target: DEFAULT_SETTINGS.targetCoolThreads,
  });
  const staleHydration = useRef(false);
  const menuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchCooldownRemaining = Math.max(
    0,
    Math.ceil((searchCooldownUntil - nowMs) / 1000),
  );
  const searchBlocked = searching || searchCooldownRemaining > 0;

  function clearMenuCloseTimer() {
    if (menuCloseTimer.current) {
      clearTimeout(menuCloseTimer.current);
      menuCloseTimer.current = null;
    }
  }

  function openMenu() {
    clearMenuCloseTimer();
    setMenuOpen(true);
    setMenuEntered(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setMenuEntered(true));
    });
  }

  function closeMenu() {
    if (!menuOpen) return;
    setMenuEntered(false);
    clearMenuCloseTimer();
    menuCloseTimer.current = setTimeout(() => {
      setMenuOpen(false);
      menuCloseTimer.current = null;
    }, 160);
  }

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
      if (prev[prev.length - 1]?.message === message) return prev;
      return [...prev, entry].slice(-1000);
    });
    setScoutLogPage(0);
    void fetch("/api/scout/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }).catch(() => {
      /* sidecar may be offline — keep in-memory */
    });
  }

  function applyScoutEvent(ev: ScoutStreamEvent) {
    const stage = (ev.stage ?? "planning") as ScoutStageId;
    if (typeof ev.coolCount === "number") {
      coolProgressRef.current.cool = ev.coolCount;
    }
    if (typeof ev.targetCool === "number") {
      coolProgressRef.current.target = ev.targetCool;
    }
    let message = ev.message || scoutStageMessage(stage);
    // Prefer server bucket copy; avoid double-prefixing Candidates/Cool lines.
    if (
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
    setScoutStage(stage);
    setStatus(message);
    pushScoutLine(message, stage);
  }

  async function hydrateScoutLog() {
    try {
      const res = await fetch("/api/scout/log");
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
      setScoutLogPage(0);
    } catch {
      /* ignore */
    }
  }

  function onStopScout() {
    abortRef.current?.abort();
  }

  function updateTargetCoolThreads(value: number) {
    const targetCoolThreads = clampTargetCoolThreads(value);
    setSettings((prev) => ({ ...prev, targetCoolThreads }));
    saveSettings({ ...settings, targetCoolThreads });
    setSettingsDraft((prev) => ({ ...prev, targetCoolThreads }));
  }

  async function hydrateInteracted() {
    try {
      const res = await fetch("/api/interacted");
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
      const activeIds = Array.isArray(data.activeIds)
        ? data.activeIds
        : [];
      setInteractedIds(
        new Set(
          activeIds.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
        ),
      );
    } catch {
      // Sidecar may be offline on first paint — ignore.
    }
  }

  async function hydrateLastScout() {
    try {
      const res = await fetch(`/api/scout/last?dedupeAccounts=${settings.dedupeAccounts}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok?: boolean;
        empty?: boolean;
        snapshot?: {
          savedAt: string;
          agenda?: string;
          queries?: string[];
          threads?: ThreadCard[];
          message?: string;
          pipelineCounts?: {
            raw: number;
            afterDedupe: number;
            afterCooldown: number;
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
      const queries = Array.isArray(data.snapshot.queries)
        ? data.snapshot.queries
        : [];
      if (typeof data.snapshot.agenda === "string" && data.snapshot.agenda.trim()) {
        setAgenda(data.snapshot.agenda);
      }
      setThreads(list);
      setPlannedQueries(queries);
      setScoutStage(null);
      const when =
        formatAbsoluteTime(data.snapshot.savedAt) ||
        formatTimeAgo(data.snapshot.savedAt) ||
        "earlier";
      const pc = data.snapshot.pipelineCounts;
      const funnel = pc
        ? ` (${pc.raw} → ${pc.afterDedupe} → ${pc.afterCooldown} → ${pc.afterLength} → ${pc.afterTriage})`
        : "";
      setStatus(
        `Restored ${list.length} threads${funnel} from ${when} — Search again to refresh.`,
      );
    } catch {
      // Sidecar may be offline on first paint — ignore.
    }
  }

  useEffect(() => {
    void hydrateInteracted();
    void hydrateLastScout();
    void hydrateScoutLog();
  }, []);

  // Prevent mouse wheel from changing number inputs while scrolling the page.
  useEffect(() => {
    function onWheel(e: WheelEvent) {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (t.type !== "number") return;
      e.preventDefault();
    }
    document.addEventListener("wheel", onWheel, { passive: false });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);

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

  // Keep scout-log / cooldown "time ago" labels fresh (1s while live or logged).
  useEffect(() => {
    if (!searching && scoutLog.length === 0) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [searching, scoutLog.length > 0]);

  useEffect(() => {
    return () => clearMenuCloseTimer();
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      setMenuEntered(false);
      return;
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setMenuEntered(true));
    });
    return () => cancelAnimationFrame(id);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  function openMarkModal(thread: ThreadCard) {
    setMarkThread(thread);
    setMarkReplyUrl("");
    setMarkReply("");
  }

  function closeMarkModal() {
    setMarkThread(null);
    setMarkReplyUrl("");
    setMarkReply("");
  }

  async function postInteracted(
    thread: ThreadCard,
    replyUrl: string,
    reply: string,
  ): Promise<boolean> {
    const urlTrimmed = replyUrl.trim();
    const replyId = parseStatusIdFromUrl(urlTrimmed);
    if (!replyId) {
      setStatus("Reply URL is required — paste the link to your reply on X.");
      return false;
    }
    const trimmed = reply.trim();
    try {
      const res = await fetch("/api/interacted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          author: thread.author,
          source: "manual",
          replyUrl: urlTrimmed,
          ...(trimmed ? { reply: trimmed } : {}),
          agenda,
          url: thread.url,
          text: thread.text,
          summary: thread.summary,
          baitScore: thread.baitScore ?? thread.score,
          engage: thread.engage,
          flags: thread.flags,
          intent: thread.intent,
          reason: thread.reason,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        interaction?: InteractionHistoryEntry;
      };
      if (!res.ok) {
        setStatus(`Mark fail: ${data.message || res.status}`);
        return false;
      }
      const key = normalizeAuthorKey(thread.author);
      setInteractedIds((prev) => new Set(prev).add(thread.id));
      const historyEntry: InteractionHistoryEntry = data.interaction ?? {
        threadId: thread.id,
        author: thread.author,
        at: new Date().toISOString(),
        url: thread.url,
        summary: thread.summary,
        text: thread.text,
        replyId,
        replyUrl: urlTrimmed,
        postedAt: new Date().toISOString(),
      };
      setInteractedHistory((prev) => [
        historyEntry,
        ...prev.filter((i) => i.threadId !== thread.id),
      ]);
      // Drop this author from Curated so we stop engaging the same account.
      setThreads((prev) => prev.filter((t) => normalizeAuthorKey(t.author) !== key));
      setExpandedId((id) => (id === thread.id ? null : id));
      return true;
    } catch {
      setStatus("Sidecar offline — could not mark interacted");
      return false;
    }
  }

  async function onVerifySession() {
    setBusy(true);
    setStatus("Verifying X session…");
    try {
      const res = await fetch("/api/session/verify");
      const data = (await res.json()) as {
        ok?: boolean;
        user?: { screen_name: string; name: string };
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setSessionUser(null);
        setStatus(`Session fail: ${data.message || data.error || res.status}`);
        return;
      }
      if (data.user?.screen_name) {
        setSessionUser({
          screen_name: data.user.screen_name,
          name: data.user.name ?? data.user.screen_name,
        });
      }
      setStatus(`Session OK — @${data.user?.screen_name} (${data.user?.name})`);
      closeMenu();
    } catch {
      setSessionUser(null);
      setStatus("Sidecar offline — run ./pm2-manager.sh restart or npm run dev:server");
    } finally {
      setBusy(false);
    }
  }

  function openSettings() {
    setSettingsDraft(settings);
    setSettingsStatus("");
    setView("settings");
    closeMenu();
  }

  function onSaveSettings() {
    const next = saveSettings(settingsDraft);
    setSettings(next);
    setSettingsDraft(next);
    setSettingsStatus("Saved — next Start Scout will use these filters.");
  }

  async function onSearch() {
    if (Date.now() < searchingRef.current) {
      if (isFinite(searchingRef.current)) {
        const waitSec = Math.ceil((searchingRef.current - Date.now()) / 1000);
        const line = formatScoutFailure(
          `Wait ${waitSec}s before starting Scout again.`,
          { soft: true },
        );
        setScoutStage("error");
        setStatus(line);
        pushScoutLine(line, "error");
      }
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    searchingRef.current = Infinity;
    staleHydration.current = true;

    const targetCool = clampTargetCoolThreads(settings.targetCoolThreads);
    coolProgressRef.current = { cool: 0, target: targetCool };

    setBusy(true);
    setSearching(true);
    setPlannedQueries([]);
    // Keep existing thread rows; partials + done append by id across runs.
    setExpandedId(null);
    pushScoutLine("── Start Scout ──", "planning");
    applyScoutEvent({
      stage: "planning",
      message: scoutStageMessage("planning"),
      coolCount: 0,
      targetCool,
    });

    try {
      const res = await fetch("/api/scout/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({
          agenda,
          targetCool,
          filters: {
            maxThreadChars: settings.maxThreadChars,
            dropArticles: settings.dropArticles,
            dedupeAccounts: settings.dedupeAccounts,
          },
        }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const fallback = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        const detail =
          fallback.message ||
          fallback.error ||
          (!res.body ? "empty response body" : `HTTP ${res.status}`);
        const soft = isScoutGateError(res.status, fallback);
        const line = formatScoutFailure(detail, { soft });
        setScoutStage("error");
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
          if (ev.queries) {
            setPlannedQueries(ev.queries);
          }
          return;
        }
        if (ev.stage === "error") {
          applyScoutEvent(ev);
          stream.sawError = true;
          return;
        }
        applyScoutEvent(ev);
        if (ev.stage === "partial" && ev.threads?.length) {
          setThreads((prev) => appendThreadsById(prev, ev.threads));
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
        setPlannedQueries(qs);
        // Append this run’s cool threads; do not wipe prior Scout loops.
        setThreads((prev) => appendThreadsById(prev, list));
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
          (doneEvent.lengthWarning ? ` · ${doneEvent.lengthWarning}` : "");
        setScoutStage("done");
        setStatus(summary);
        pushScoutLine(summary);
      } else if (!stream.sawError) {
        const line = formatScoutFailure("stream ended without results");
        setScoutStage("error");
        setStatus(line);
        pushScoutLine(line, "error");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Still cool down in finally so Stop / unmount cannot bypass the gate.
        const { cool, target } = coolProgressRef.current;
        const summary = `Cool ${cool}/${target} · stop: aborted`;
        setScoutStage("done");
        setStatus(summary);
        pushScoutLine(summary);
      } else {
        const line = formatScoutFailure(
          "Sidecar offline — run ./pm2-manager.sh restart or npm run dev:server",
        );
        setScoutStage("error");
        setStatus(line);
        pushScoutLine(line, "error");
      }
    } finally {
      if (abortRef.current === ac) {
        const until = Date.now() + SEARCH_COOLDOWN_MS;
        searchingRef.current = until;
        setSearching(false);
        setBusy(false);
        setSearchCooldownUntil(until);
        setNowMs(Date.now());
        setStatus((prev) => {
          if (/^Wait \d+s before (starting Scout|searching) again/.test(prev)) {
            return prev;
          }
          if (
            prev.startsWith("Scout failed:") ||
            prev.startsWith("Sidecar offline") ||
            /^A Scout run is already in progress/.test(prev)
          ) {
            return `${prev} · Wait ${Math.ceil(SEARCH_COOLDOWN_MS / 1000)}s before starting Scout again.`;
          }
          return prev;
        });
      }
    }
  }

  function onMark(thread: ThreadCard) {
    openMarkModal(thread);
  }

  async function confirmMarkInteracted() {
    const thread = markThread;
    if (!thread) return;
    if (!parseStatusIdFromUrl(markReplyUrl)) {
      setStatus("Reply URL is required — paste the link to your reply on X.");
      return;
    }
    setBusy(true);
    const ok = await postInteracted(thread, markReplyUrl, markReply);
    setBusy(false);
    if (ok) {
      closeMarkModal();
      setStatus(
        markReply.trim()
          ? `Marked ${thread.author} interacted — memory saved · 24h cooldown`
          : `Marked ${thread.author} interacted — 24h cooldown`,
      );
    }
  }

  useEffect(() => {
    if (!markThread) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) closeMarkModal();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markThread, busy]);

  return (
    <div className="app">
      <header className="brand">
        <div className="brand-bar">
          <div className="brand-copy">
            <h1>x-copilot</h1>
            <p>
              Agenda → Scout searches X and scores threads. You review and post.
            </p>
          </div>
          <button
            type="button"
            className="menu-toggle"
            aria-label={menuOpen && menuEntered ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen && menuEntered}
            onClick={() => {
              if (menuOpen && menuEntered) closeMenu();
              else openMenu();
            }}
          >
            <span aria-hidden="true">
              {menuOpen && menuEntered ? "✕" : "☰"}
            </span>
          </button>
        </div>
      </header>

      {menuOpen ? (
        <div className={menuEntered ? "menu-root is-open" : "menu-root"}>
          <button
            type="button"
            className="menu-backdrop"
            aria-label="Close menu"
            onClick={closeMenu}
          />
          <aside
            className={menuEntered ? "menu-sheet is-open" : "menu-sheet"}
            role="dialog"
            aria-modal="true"
            aria-label="User menu"
          >
            <div className="menu-sheet-head">
              <h2>Menu</h2>
              <button type="button" className="ghost" onClick={closeMenu}>
                Close
              </button>
            </div>
            <p className="menu-session">
              {sessionUser
                ? `@${sessionUser.screen_name} · ${sessionUser.name}`
                : "Session not verified"}
            </p>
            <div className="menu-actions">
              <button
                type="button"
                className="ghost menu-action"
                disabled={busy}
                onClick={() => void onVerifySession()}
              >
                Verify session
              </button>
              <button
                type="button"
                className="primary menu-action"
                onClick={openSettings}
              >
                Settings
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {view === "settings" ? (
        <section className="panel settings-pane">
          <div className="settings-head">
            <h2>Settings</h2>
            <button
              type="button"
              className="ghost"
              onClick={() => setView("dashboard")}
            >
              Back
            </button>
          </div>
          <p className="status">
            Filter prefs apply on the next Scout search. Env defaults remain the
            fallback when overrides are omitted.
          </p>
          <label className="settings-field">
            <span>Max thread characters</span>
            <input
              type="number"
              min={120}
              max={2000}
              step={1}
              value={settingsDraft.maxThreadChars}
              onChange={(e) =>
                setSettingsDraft((prev) => ({
                  ...prev,
                  maxThreadChars: clampMaxThreadChars(
                    e.target.value === ""
                      ? DEFAULT_SETTINGS.maxThreadChars
                      : Number(e.target.value),
                  ),
                }))
              }
            />
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={settingsDraft.dropArticles}
              onChange={(e) =>
                setSettingsDraft((prev) => ({
                  ...prev,
                  dropArticles: e.target.checked,
                }))
              }
            />
            <span>Drop X Articles</span>
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={settingsDraft.dedupeAccounts}
              onChange={(e) =>
                setSettingsDraft((prev) => ({
                  ...prev,
                  dedupeAccounts: e.target.checked,
                }))
              }
            />
            <span>Dedupe accounts I&apos;ve interacted with</span>
          </label>
          <label className="settings-field">
            <span>Cool threads target (1–20)</span>
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={settingsDraft.targetCoolThreads}
              onChange={(e) =>
                setSettingsDraft((prev) => ({
                  ...prev,
                  targetCoolThreads: clampTargetCoolThreads(
                    e.target.value === ""
                      ? DEFAULT_SETTINGS.targetCoolThreads
                      : Number(e.target.value),
                  ),
                }))
              }
            />
          </label>
          <p className="settings-readonly">Author cooldown: 24 hours</p>
          <div className="row">
            <button type="button" className="primary" onClick={onSaveSettings}>
              Save
            </button>
          </div>
          {settingsStatus ? <p className="status">{settingsStatus}</p> : null}
        </section>
      ) : (
        <div className="dashboard">
          <section className="panel control-pane">
            <h2>Agenda</h2>
            <textarea
              className="agenda"
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              placeholder="What should we look for and how should we sound?"
            />
            <div className="row scout-controls">
              {searching ? (
                <button
                  type="button"
                  className="primary"
                  onClick={onStopScout}
                >
                  Stop Scout
                </button>
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={busy || searchBlocked || !agenda.trim()}
                  onClick={onSearch}
                >
                  {searchCooldownRemaining > 0
                    ? `Wait ${searchCooldownRemaining}s`
                    : "Start Scout"}
                </button>
              )}
              <label className="cool-target">
                <span>Cool threads</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  disabled={searching}
                  value={settings.targetCoolThreads}
                  onChange={(e) =>
                    updateTargetCoolThreads(
                      e.target.value === ""
                        ? DEFAULT_SETTINGS.targetCoolThreads
                        : Number(e.target.value),
                    )
                  }
                />
              </label>
            </div>
            <div className="status-stack" aria-live="polite">
              <p className="status status-hint">
                Fills a hard-filter bucket of 5, then LLM-qualifies until ≥1
                cool lead (target kept for later).
              </p>
              <p className="status status-main">
                {searchCooldownRemaining > 0 && !searching
                  ? `Wait ${searchCooldownRemaining}s before starting Scout again.`
                  : status || "\u00a0"}
              </p>
              <p className="status status-queries">
                {plannedQueries.length > 0
                  ? `Queries: ${plannedQueries.map((q) => `"${q}"`).join(" · ")}`
                  : "\u00a0"}
              </p>
            </div>
            <div
              className={searching ? "scout-strip active" : "scout-strip"}
            >
              <div className="scout-strip-head">
                <span className="scout-label">Scout</span>
                <span className="scout-stage">
                  {scoutStage === "error"
                    ? status || scoutStageMessage("error")
                    : scoutStage
                      ? scoutStageMessage(scoutStage)
                      : searching
                        ? status
                        : "Idle — ready when you start Scout"}
                </span>
              </div>
              <div
                className={searching ? "scout-bar" : "scout-bar idle"}
                aria-hidden="true"
              />
              {(() => {
                const pageCount = Math.max(
                  1,
                  Math.ceil(scoutLog.length / SCOUT_LOG_PAGE_SIZE) || 1,
                );
                const page = Math.min(scoutLogPage, pageCount - 1);
                const end = scoutLog.length - page * SCOUT_LOG_PAGE_SIZE;
                const start = Math.max(0, end - SCOUT_LOG_PAGE_SIZE);
                // Newest first: sort by timestamp (don't rely only on append order).
                const pageEntries = scoutLog
                  .slice(start, end)
                  .sort(
                    (a, b) =>
                      Date.parse(b.at) - Date.parse(a.at) ||
                      b.message.localeCompare(a.message),
                  );
                return (
                  <div className="scout-log-panel">
                    <ul className="scout-log">
                      {pageEntries.length > 0 ? (
                        pageEntries.map((entry) => {
                          const ago = formatTimeAgo(entry.at, nowMs);
                          const absolute = formatAbsoluteTime(entry.at);
                          return (
                            <li
                              key={`${entry.at}-${entry.stage ?? ""}-${entry.message}`}
                            >
                              <span
                                className="scout-log-ago"
                                title={absolute ?? undefined}
                              >
                                {ago ?? "—"}
                              </span>
                              <span className="scout-log-msg">{entry.message}</span>
                            </li>
                          );
                        })
                      ) : (
                        <li className="scout-log-empty">
                          Stage log appears here
                        </li>
                      )}
                    </ul>
                    <div className="scout-log-pager">
                      <button
                        type="button"
                        className="ghost scout-log-page-btn"
                        disabled={page >= pageCount - 1 || scoutLog.length === 0}
                        onClick={() => setScoutLogPage((p) => p + 1)}
                      >
                        Older
                      </button>
                      <span className="scout-log-page-label">
                        {scoutLog.length === 0
                          ? "0"
                          : `${page + 1}/${pageCount} · ${scoutLog.length}`}
                      </span>
                      <button
                        type="button"
                        className="ghost scout-log-page-btn"
                        disabled={page <= 0}
                        onClick={() =>
                          setScoutLogPage((p) => Math.max(0, p - 1))
                        }
                      >
                        Newer
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </section>

          <section className="threads-pane">
            <div className="threads-pane-head">
              <h2 className="section-label">Threads</h2>
              <div className="threads-tabs" role="tablist" aria-label="Thread feeds">
                <button
                  type="button"
                  role="tab"
                  aria-selected={threadsTab === "curated"}
                  className={
                    threadsTab === "curated"
                      ? "threads-tab active"
                      : "threads-tab"
                  }
                  onClick={() => setThreadsTab("curated")}
                >
                  Curated{threads.length > 0 ? ` (${threads.length})` : ""}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={threadsTab === "interacted"}
                  className={
                    threadsTab === "interacted"
                      ? "threads-tab active"
                      : "threads-tab"
                  }
                  onClick={() => setThreadsTab("interacted")}
                >
                  Interacted
                  {interactedHistory.length > 0
                    ? ` (${interactedHistory.length})`
                    : ""}
                </button>
              </div>
            </div>
            <div className="threads-scroll">
              {threadsTab === "curated" ? (
                threads.length === 0 ? (
                  <p className="empty">
                    {searching
                      ? "Scout is working…"
                      : "No curated threads yet. Set an agenda and search."}
                  </p>
                ) : (
                  <div className="threads">
                    {sortThreadsByCreatedAtNewest(threads).map((t) => (
                      <ThreadRow
                        key={t.id}
                        thread={t}
                        open={expandedId === t.id}
                        busy={busy}
                        interacted={interactedIds.has(t.id)}
                        onToggle={() =>
                          setExpandedId(expandedId === t.id ? null : t.id)
                        }
                        onMark={() => onMark(t)}
                      />
                    ))}
                  </div>
                )
              ) : interactedHistory.length === 0 ? (
                <p className="empty">
                  No interacted threads yet. Mark a curated lead after you reply
                  on X.
                </p>
              ) : (
                <div className="threads">
                  {interactedHistory.map((entry) => (
                    <InteractedRow
                      key={entry.threadId}
                      entry={entry}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {markThread ? (
        <div className="modal-root" role="presentation">
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Cancel mark interacted"
            disabled={busy}
            onClick={closeMarkModal}
          />
          <div
            className="modal-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mark-reply-title"
          >
            <h2 id="mark-reply-title">Mark interacted</h2>
            <p className="status">
              Paste the URL of the reply you posted on X for {markThread.author}.
              Optional reply text is saved to local knowledge memory.
            </p>
            <label className="settings-field">
              <span>Reply URL on X</span>
              <input
                className="mark-reply"
                type="url"
                value={markReplyUrl}
                onChange={(e) => setMarkReplyUrl(e.target.value)}
                placeholder="https://x.com/you/status/…"
                autoFocus
              />
            </label>
            <label className="settings-field">
              <span>Reply text (optional, for memory)</span>
              <textarea
                className="mark-reply"
                value={markReply}
                onChange={(e) => setMarkReply(e.target.value)}
                placeholder="What you actually typed / posted…"
                rows={4}
              />
            </label>
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={busy || !parseStatusIdFromUrl(markReplyUrl)}
                onClick={() => void confirmMarkInteracted()}
              >
                Confirm
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={closeMarkModal}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
