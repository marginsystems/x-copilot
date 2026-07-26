import { useState } from "react";
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

type Draft = {
  threadId: string;
  text: string;
};

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
  onToggle,
  onDraft,
  onCopy,
}: {
  thread: ThreadCard;
  open: boolean;
  draft: Draft | null;
  busy: boolean;
  onToggle: () => void;
  onDraft: () => void;
  onCopy: () => void;
}) {
  const bait = baitRisk(thread);
  const ago = formatTimeAgo(thread.createdAt);
  const absolute = formatAbsoluteTime(thread.createdAt);
  const tags = [thread.intent, ...(thread.flags ?? [])].filter(Boolean);
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
        <span
          className={baitClass(bait)}
          title="Engagement-bait risk — higher is worse"
        >
          {bait ?? "—"}
        </span>
        <span className="row-main">
          <span className="row-summary">{thread.summary ?? thread.text}</span>
          <span className="row-meta">
            <span>{thread.author}</span>
            {ago ? <span title={absolute ?? undefined}>{ago}</span> : null}
            {thread.engage === "skip" || thread.engage === "priority" ? (
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
              <button className="ghost" onClick={onCopy}>
                Copy reply
              </button>
            ) : null}
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
  const [status, setStatus] = useState("Idle — verify session, then search from agenda");
  const [plannedQueries, setPlannedQueries] = useState<string[]>([]);
  const [threads, setThreads] = useState<ThreadCard[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    setPlannedQueries([]);
    setStatus("Planning search queries with DeepSeek V4 Flash…");
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agenda }),
      });
      const data = (await res.json()) as {
        threads?: ThreadCard[];
        queries?: string[];
        message?: string;
        error?: string;
        model?: string;
        triageWarning?: string;
      };
      if (!res.ok) {
        setThreads([]);
        setExpandedId(null);
        setStatus(`Search fail: ${data.message || data.error || res.status}`);
        return;
      }
      const qs = data.queries ?? [];
      const list = data.threads ?? [];
      setPlannedQueries(qs);
      setThreads(list);
      setExpandedId(null);
      setDraft(null);
      const qLabel = qs.length ? qs.map((q) => `"${q}"`).join(", ") : "(none)";
      setStatus(
        `Loaded ${list.length} threads via ${data.model || "deepseek-chat"} — ${qLabel}` +
          (data.triageWarning ? ` · ${data.triageWarning}` : ""),
      );
    } catch {
      setThreads([]);
      setExpandedId(null);
      setStatus("Sidecar offline — run ./pm2-manager.sh restart or npm run dev:server");
    } finally {
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
      setDraft({ threadId: thread.id, text: data.draft });
      setStatus("Draft ready — edit, then copy");
    } catch {
      setDraft({ threadId: thread.id, text: placeholder });
      setStatus("Draft API offline — local placeholder draft");
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    if (!draft) return;
    await navigator.clipboard.writeText(draft.text);
    setStatus("Copied — paste manually on X");
  }

  return (
    <div className="app">
      <header className="brand">
        <h1>x-copilot</h1>
        <p>
          Agenda → DeepSeek V4 Flash queries → session X search. You review and post.
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
      </section>

      <h2 className="section-label">
        Threads{threads.length > 0 ? ` (${threads.length})` : ""}
      </h2>
      {threads.length === 0 ? (
        <p className="empty">No threads yet. Set an agenda and search.</p>
      ) : (
        <div className="threads">
          {threads.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              open={expandedId === t.id}
              draft={draft?.threadId === t.id ? draft : null}
              busy={busy}
              onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
              onDraft={() => onDraft(t)}
              onCopy={onCopy}
            />
          ))}
        </div>
      )}
    </div>
  );
}
