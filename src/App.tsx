import { useEffect, useRef, useState } from "react";
import { scoutStageMessage, type ScoutStageId } from "./lib/scoutStages";
import {
  loadSettings,
  saveSettings,
  type AppSettings,
  clampMaxThreadChars,
  DEFAULT_SETTINGS,
} from "./lib/settings";
import { formatAbsoluteTime, formatTimeAgo } from "./lib/timeAgo";

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
  triageWarning?: string;
  cooldownWarning?: string;
  lengthWarning?: string;
};

type Draft = {
  threadId: string;
  text: string;
};

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

function ThreadRow({
  thread,
  open,
  draft,
  busy,
  interacted,
  onToggle,
  onDraft,
  onCopy,
  onMark,
}: {
  thread: ThreadCard;
  open: boolean;
  draft: Draft | null;
  busy: boolean;
  interacted: boolean;
  onToggle: () => void;
  onDraft: () => void;
  onCopy: () => void;
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
            <button className="primary" disabled={busy} onClick={onDraft}>
              Draft reply
            </button>
            {draft ? (
              <button className="ghost" disabled={busy} onClick={onCopy}>
                Copy reply
              </button>
            ) : null}
            <button className="ghost" disabled={busy || interacted} onClick={onMark}>
              {interacted ? "Interacted" : "Mark interacted"}
            </button>
          </div>
          {draft ? <div className="draft">{draft.text}</div> : null}
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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [scoutStage, setScoutStage] = useState<ScoutStageId | null>(null);
  const [scoutLog, setScoutLog] = useState<string[]>([]);
  const [interactedIds, setInteractedIds] = useState<Set<string>>(() => new Set());
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
  const abortRef = useRef<AbortController | null>(null);
  const searchingRef = useRef(0);
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

  function pushScoutLine(line: string) {
    setScoutLog((prev) => {
      if (prev[prev.length - 1] === line) return prev;
      return [...prev.slice(-5), line];
    });
  }

  function applyScoutEvent(ev: ScoutStreamEvent) {
    const stage = (ev.stage ?? "planning") as ScoutStageId;
    const message = ev.message || scoutStageMessage(stage);
    setScoutStage(stage);
    setStatus(message);
    pushScoutLine(message);
  }

  async function hydrateInteracted() {
    try {
      const res = await fetch("/api/interacted");
      if (!res.ok) return;
      const data = (await res.json()) as {
        interactions?: Array<{ threadId?: string }>;
      };
      const ids = new Set(
        (data.interactions ?? [])
          .map((i) => i.threadId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      );
      setInteractedIds(ids);
    } catch {
      // Sidecar may be offline on first paint — ignore.
    }
  }

  async function hydrateLastScout() {
    try {
      const res = await fetch("/api/scout/last");
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
      setStatus(
        `Restored ${list.length} threads from ${when} — Search again to refresh.`,
      );
    } catch {
      // Sidecar may be offline on first paint — ignore.
    }
  }

  useEffect(() => {
    void hydrateInteracted();
    void hydrateLastScout();
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

  async function postInteracted(
    thread: ThreadCard,
    source: "manual" | "copy",
  ): Promise<boolean> {
    try {
      const res = await fetch("/api/interacted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          author: thread.author,
          source,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setStatus(`Mark fail: ${data.message || res.status}`);
        return false;
      }
      const key = normalizeAuthorKey(thread.author);
      setInteractedIds((prev) => new Set(prev).add(thread.id));
      // Drop this author from the live list so we stop engaging the same account.
      setThreads((prev) => prev.filter((t) => normalizeAuthorKey(t.author) !== key));
      setExpandedId((id) => (id === thread.id ? null : id));
      setDraft((d) => (d?.threadId === thread.id ? null : d));
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
    setSettingsStatus("Saved — next Search will use these filters.");
  }

  async function onSearch() {
    if (Date.now() < searchingRef.current) {
      if (isFinite(searchingRef.current)) {
        const waitSec = Math.ceil((searchingRef.current - Date.now()) / 1000);
        setStatus(`Wait ${waitSec}s before searching again.`);
      }
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    searchingRef.current = Infinity;
    staleHydration.current = true;

    setBusy(true);
    setSearching(true);
    setPlannedQueries([]);
    setThreads([]);
    setExpandedId(null);
    setDraft(null);
    setScoutLog([]);
    applyScoutEvent({
      stage: "planning",
      message: scoutStageMessage("planning"),
    });

    try {
      const res = await fetch("/api/scout/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({
          agenda,
          filters: {
            maxThreadChars: settings.maxThreadChars,
            dropArticles: settings.dropArticles,
          },
        }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const fallback = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        setScoutStage("error");
        setThreads([]);
        setStatus(
          `Scout failed: ${fallback.message || fallback.error || res.status}`,
        );
        pushScoutLine(scoutStageMessage("error"));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let doneEvent: ScoutStreamEvent | null = null;
      let sawError = false;

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
          if (ev.stage === "done") {
            doneEvent = ev;
            applyScoutEvent(ev);
          } else if (ev.stage === "error") {
            applyScoutEvent(ev);
            setThreads([]);
            sawError = true;
          } else {
            applyScoutEvent(ev);
          }
        }
      }

      if (buffer.trim()) {
        try {
          const ev = JSON.parse(buffer.trim()) as ScoutStreamEvent;
          if (ev.stage === "done") doneEvent = ev;
          applyScoutEvent(ev);
        } catch {
          /* ignore trailing junk */
        }
      }

      if (doneEvent) {
        const qs = doneEvent.queries ?? [];
        const list = doneEvent.threads ?? [];
        setPlannedQueries(qs);
        setThreads(list);
        setExpandedId(null);
        setDraft(null);
        await hydrateInteracted();
        const qLabel = qs.length ? qs.map((q) => `"${q}"`).join(", ") : "(none)";
        const summary =
          `Scout found ${list.length} threads — ${qLabel}` +
          (doneEvent.triageWarning ? ` · ${doneEvent.triageWarning}` : "") +
          (doneEvent.cooldownWarning ? ` · ${doneEvent.cooldownWarning}` : "") +
          (doneEvent.lengthWarning ? ` · ${doneEvent.lengthWarning}` : "");
        setScoutStage("done");
        setStatus(summary);
        pushScoutLine(summary);
      } else if (!sawError) {
        setScoutStage("error");
        setStatus("Scout failed: stream ended without results");
        pushScoutLine(scoutStageMessage("error"));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Still cool down in finally so spam-unmount/abort cannot bypass.
      } else {
        setScoutStage("error");
        setThreads([]);
        setStatus("Sidecar offline — run ./pm2-manager.sh restart or npm run dev:server");
        pushScoutLine(scoutStageMessage("error"));
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
          if (/^Wait \d+s before searching again/.test(prev)) return prev;
          if (prev.startsWith("Scout failed:") || prev.startsWith("Sidecar offline")) {
            return `${prev} · Wait ${Math.ceil(SEARCH_COOLDOWN_MS / 1000)}s before searching again.`;
          }
          return prev;
        });
      }
    }
  }

  async function onDraft(thread: ThreadCard) {
    setBusy(true);
    setStatus("Drafting with DeepSeek… (draft API still stub)");
    const placeholder = `Thanks for raising this — here's a concise take based on: "${thread.text.slice(0, 80)}…"`;
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agenda, thread }),
      });
      if (!res.ok) {
        setDraft({ threadId: thread.id, text: placeholder });
        setStatus(`Draft API ${res.status} — local placeholder draft`);
        return;
      }
      const data = (await res.json()) as { draft: string };
      if (typeof data.draft !== "string") {
        setDraft({ threadId: thread.id, text: placeholder });
        setStatus("Draft API returned invalid response — local placeholder draft");
        return;
      }
      setDraft({ threadId: thread.id, text: data.draft });
      setStatus("Draft ready — edit, then copy");
    } catch {
      setDraft({ threadId: thread.id, text: placeholder });
      setStatus("Draft API offline — local placeholder draft");
    } finally {
      setBusy(false);
    }
  }

  async function onCopy(thread: ThreadCard) {
    if (!draft || draft.threadId !== thread.id) return;
    setBusy(true);
    try {
      await navigator.clipboard.writeText(draft.text);
    } catch {
      setBusy(false);
      setStatus("Copy failed — clipboard API unavailable or permission denied");
      return;
    }
    const ok = await postInteracted(thread, "copy");
    setBusy(false);
    if (ok) {
      setStatus("Copied — marked interacted (24h author cooldown)");
    }
  }

  async function onMark(thread: ThreadCard) {
    setBusy(true);
    const ok = await postInteracted(thread, "manual");
    setBusy(false);
    if (ok) {
      setStatus(`Marked ${thread.author} interacted — cooled down for 24h`);
    }
  }

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
            <div className="row">
              <button
                className="primary"
                disabled={busy || searchBlocked || !agenda.trim()}
                onClick={onSearch}
              >
                {searchCooldownRemaining > 0
                  ? `Wait ${searchCooldownRemaining}s`
                  : searching
                    ? "Searching…"
                    : "Search threads"}
              </button>
            </div>
            <p className="status">
              {searchCooldownRemaining > 0 && !searching
                ? `Wait ${searchCooldownRemaining}s before searching again.`
                : status}
            </p>
            <p className="status status-queries">
              {plannedQueries.length > 0
                ? `Queries: ${plannedQueries.map((q) => `"${q}"`).join(" · ")}`
                : "\u00a0"}
            </p>
            <div
              className={searching ? "scout-strip active" : "scout-strip"}
              aria-live="polite"
            >
              <div className="scout-strip-head">
                <span className="scout-label">Scout</span>
                <span className="scout-stage">
                  {scoutStage
                    ? scoutStageMessage(scoutStage)
                    : searching
                      ? status
                      : "Idle — ready when you search"}
                </span>
              </div>
              <div
                className={searching ? "scout-bar" : "scout-bar idle"}
                aria-hidden="true"
              />
              <ul className="scout-log">
                {scoutLog.length > 0 ? (
                  scoutLog.map((line, i) => (
                    <li key={`${i}-${line}`}>{line}</li>
                  ))
                ) : (
                  <li className="scout-log-empty">Stage log appears here</li>
                )}
              </ul>
            </div>
          </section>

          <section className="threads-pane">
            <h2 className="section-label">
              Threads{threads.length > 0 ? ` (${threads.length})` : ""}
            </h2>
            <div className="threads-scroll">
              {threads.length === 0 ? (
                <p className="empty">
                  {searching
                    ? "Scout is working…"
                    : "No threads yet. Set an agenda and search."}
                </p>
              ) : (
                <div className="threads">
                  {threads.map((t) => (
                    <ThreadRow
                      key={t.id}
                      thread={t}
                      open={expandedId === t.id}
                      draft={draft?.threadId === t.id ? draft : null}
                      busy={busy}
                      interacted={interactedIds.has(t.id)}
                      onToggle={() =>
                        setExpandedId(expandedId === t.id ? null : t.id)
                      }
                      onDraft={() => onDraft(t)}
                      onCopy={() => onCopy(t)}
                      onMark={() => onMark(t)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
