import { useEffect, useRef, useState } from "react";
import { scoutStageMessage, type ScoutStageId } from "./lib/scoutStages";
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
  const abortRef = useRef<AbortController | null>(null);

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

  useEffect(() => {
    void hydrateInteracted();
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

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
        setStatus(`Session fail: ${data.message || data.error || res.status}`);
        return;
      }
      setStatus(`Session OK — @${data.user?.screen_name} (${data.user?.name})`);
    } catch {
      setStatus("Sidecar offline — run ./pm2-manager.sh restart or npm run dev:server");
    } finally {
      setBusy(false);
    }
  }

  async function onSearch() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

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
        body: JSON.stringify({ agenda }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const fallback = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        setScoutStage(null);
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
<<<<<<< HEAD
<<<<<<< HEAD
      } else if (!sawError) {
        setScoutStage(null);
=======
      } else {
=======
      } else if (!sawError) {
>>>>>>> bc1ade5 (fix: add unmount cleanup and preserve specific error messages from stream)
        setScoutStage("error");
>>>>>>> a7403c1 (Fix: handle error events without done event leaving UI stuck in searching state)
        setStatus("Scout failed: stream ended without results");
        pushScoutLine(scoutStageMessage("error"));
      } else {
        setScoutStage(null);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setScoutStage(null);
      setThreads([]);
      setStatus("Sidecar offline — run ./pm2-manager.sh restart or npm run dev:server");
      pushScoutLine(scoutStageMessage("error"));
    } finally {
      setSearching(false);
      setBusy(false);
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
        <h1>x-copilot</h1>
        <p>
          Agenda → Scout searches X and scores threads. You review and post.
        </p>
      </header>

      <section className="panel">
        <h2>Agenda</h2>
        <textarea
          className="agenda"
          value={agenda}
          onChange={(e) => setAgenda(e.target.value)}
          placeholder="What should we look for and how should we sound?"
        />
        <div className="row">
          <button className="ghost" disabled={busy} onClick={onVerifySession}>
            Verify session
          </button>
          <button
            className="primary"
            disabled={busy || !agenda.trim()}
            onClick={onSearch}
          >
            Search threads
          </button>
        </div>
        <p className="status">{status}</p>
        {plannedQueries.length > 0 ? (
          <p className="status">
            Queries: {plannedQueries.map((q) => `"${q}"`).join(" · ")}
          </p>
        ) : null}
        {searching || scoutStage ? (
          <div
            className={searching ? "scout-strip active" : "scout-strip"}
            aria-live="polite"
          >
            <div className="scout-strip-head">
              <span className="scout-label">Scout</span>
              <span className="scout-stage">
                {scoutStage ? scoutStageMessage(scoutStage) : status}
              </span>
            </div>
            {searching ? <div className="scout-bar" aria-hidden="true" /> : null}
            {scoutLog.length > 0 ? (
              <ul className="scout-log">
                {scoutLog.map((line, i) => (
                  <li key={`${i}-${line}`}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <h2 className="section-label">
        Threads{threads.length > 0 ? ` (${threads.length})` : ""}
      </h2>
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
              onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
              onDraft={() => onDraft(t)}
              onCopy={() => onCopy(t)}
              onMark={() => onMark(t)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
