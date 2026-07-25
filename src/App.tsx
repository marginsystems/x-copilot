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

const PLACEHOLDER_THREADS: ThreadCard[] = [
  {
    id: "demo-1",
    author: "@example",
    text: "Scaffold placeholder — real threads land when the session sidecar is wired.",
    url: "https://x.com",
    score: 0,
  },
];

export default function App() {
  const [agenda, setAgenda] = useState(
    "Find builders talking about shipping AI tools in public. Prefer questions I can answer helpfully.",
  );
  const [status, setStatus] = useState("Idle — sidecar not connected yet");
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
      setStatus("Sidecar offline — run npm run dev:server");
    } finally {
      setBusy(false);
    }
  }

  async function onSearch() {
    setBusy(true);
    setStatus("Searching… (stream 1: wire /api/search)");
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agenda, source: "for_you" }),
      });
      if (!res.ok) {
        setThreads(PLACEHOLDER_THREADS);
        setSelectedId(PLACEHOLDER_THREADS[0].id);
        setStatus(`Sidecar ${res.status} — showing placeholder cards`);
        return;
      }
      const data = (await res.json()) as { threads: ThreadCard[] };
      setThreads(data.threads);
      setSelectedId(data.threads[0]?.id ?? null);
      setStatus(`Loaded ${data.threads.length} threads`);
    } catch {
      setThreads(PLACEHOLDER_THREADS);
      setSelectedId(PLACEHOLDER_THREADS[0].id);
      setStatus("Sidecar offline — run npm run dev:server");
    } finally {
      setBusy(false);
    }
  }

  async function onDraft() {
    if (!selected) return;
    setBusy(true);
    setStatus("Drafting with DeepSeek… (stream 1: wire /api/draft)");
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
          Research and reply assistant for X. Session-backed search, DeepSeek drafts, you post.
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
            <button className="primary" disabled={busy} onClick={onSearch}>
              Search threads
            </button>
            <button className="ghost" disabled={busy || !selected} onClick={onDraft}>
              Draft reply
            </button>
          </div>
          <p className="status">{status}</p>

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
              <div className="meta">{selected.author}</div>
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
