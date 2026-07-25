import { useMemo, useState } from "react";

type ThreadCard = {
  id: string;
  author: string;
  text: string;
  url: string;
  score?: number;
};

type Draft = {
  threadId: string;
  text: string;
};

export default function App() {
  const [agenda, setAgenda] = useState(
    "Find builders talking about shipping AI tools in public. Prefer questions I can answer helpfully.",
  );
  const [status, setStatus] = useState("Idle — verify session, then search from agenda");
  const [plannedQueries, setPlannedQueries] = useState<string[]>([]);
  const [threads, setThreads] = useState<ThreadCard[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId],
  );

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
      };
      if (!res.ok) {
        setThreads([]);
        setSelectedId(null);
        setStatus(`Search fail: ${data.message || data.error || res.status}`);
        return;
      }
      const qs = data.queries ?? [];
      const list = data.threads ?? [];
      setPlannedQueries(qs);
      setThreads(list);
      setSelectedId(list[0]?.id ?? null);
      const qLabel = qs.length ? qs.map((q) => `"${q}"`).join(", ") : "(none)";
      setStatus(
        `Loaded ${list.length} threads via ${data.model || "deepseek-v4-flash"} — ${qLabel}`,
      );
    } catch {
      setThreads([]);
      setSelectedId(null);
      setStatus("Sidecar offline — run ./pm2-manager.sh restart or npm run dev:server");
    } finally {
      setBusy(false);
    }
  }

  async function onDraft() {
    if (!selected) return;
    setBusy(true);
    setStatus("Drafting with DeepSeek… (draft API still stub)");
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agenda, thread: selected }),
      });
      if (!res.ok) {
        setDraft({
          threadId: selected.id,
          text: `Thanks for raising this — here's a concise take based on: "${selected.text.slice(0, 80)}…"`,
        });
        setStatus(`Draft API ${res.status} — local placeholder draft`);
        return;
      }
      const data = (await res.json()) as { draft: string };
      setDraft({ threadId: selected.id, text: data.draft });
      setStatus("Draft ready — edit, then copy");
    } catch {
      setDraft({
        threadId: selected.id,
        text: `Thanks for raising this — here's a concise take based on: "${selected.text.slice(0, 80)}…"`,
      });
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

      <div className="layout">
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
            <button className="primary" disabled={busy || !agenda.trim()} onClick={onSearch}>
              Search threads
            </button>
            <button className="ghost" disabled={busy || !selected} onClick={onDraft}>
              Draft reply
            </button>
          </div>
          <p className="status">{status}</p>
          {plannedQueries.length > 0 ? (
            <p className="status">
              Queries: {plannedQueries.map((q) => `"${q}"`).join(" · ")}
            </p>
          ) : null}

          <h2>Threads</h2>
          {threads.length === 0 ? (
            <p className="empty">No threads yet. Set an agenda and search.</p>
          ) : (
            threads.map((t) => (
              <button
                key={t.id}
                type="button"
                className="thread"
                onClick={() => setSelectedId(t.id)}
                style={{
                  textAlign: "left",
                  cursor: "pointer",
                  outline: t.id === selectedId ? "1px solid var(--accent)" : undefined,
                }}
              >
                <div className="meta">
                  {t.author}
                  {typeof t.score === "number" ? ` · score ${t.score}` : ""}
                  {" · "}
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    open
                  </a>
                </div>
                <div>{t.text}</div>
              </button>
            ))
          )}
        </section>

        <section className="panel">
          <h2>Draft</h2>
          {selected ? (
            <div className="thread">
              <div className="meta">
                {selected.author} ·{" "}
                <a href={selected.url} target="_blank" rel="noreferrer">
                  open
                </a>
              </div>
              <div>{selected.text}</div>
            </div>
          ) : (
            <p className="empty">Select a thread to draft against.</p>
          )}
          <div className="draft">{draft?.text ?? "Drafts appear here."}</div>
          <div className="row">
            <button className="primary" disabled={!draft} onClick={onCopy}>
              Copy reply
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
