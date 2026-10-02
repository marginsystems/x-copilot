import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { UnpairedError } from "../../lib/api";
import { DEFAULT_DESK_ORIGIN } from "../../lib/desks";
import { planOpenOnX } from "../../lib/openOnX";
import type { Pairing } from "../../lib/pairing";
import { clearPairing, readPairing } from "../../lib/pairingStore";
import { askDeskForNext, loadPanelData, signOutExtension, type PanelData } from "../../lib/panelData";
import { panelCanAskNext, panelCard, panelNextNotice, panelPace } from "../../lib/panelModel";
import { readRepliedCardId } from "../../lib/repliedCardStore";
import { readAttentionGate, writeAttentionGate } from "../../lib/settingsStore";

const REFRESH_MS = 15_000;

type PanelState =
  | { kind: "loading" }
  | { kind: "unpaired"; notice: string | null }
  | { kind: "error"; notice: string }
  | { kind: "ready"; pairing: Pairing; data: PanelData; error: string | null };

async function openOnX(url: string): Promise<void> {
  const tabs = await browser.tabs.query({ currentWindow: true });
  const plan = planOpenOnX(tabs);
  if (plan.kind === "create") {
    await browser.tabs.create({ url, active: true });
    return;
  }
  await browser.tabs.update(plan.tabId, plan.activate ? { url, active: true } : { url });
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function App() {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [attentionGate, setAttentionGate] = useState(true);
  const [repliedCardId, setRepliedCardId] = useState<string | null>(null);
  const [nextNotice, setNextNotice] = useState<string | null>(null);
  const [askingNext, setAskingNext] = useState(false);
  const now = useNow();

  useEffect(() => {
    readAttentionGate().then(setAttentionGate, () => undefined);
  }, []);

  const refresh = useCallback(async () => {
    const pairing = await readPairing();
    if (!pairing) {
      setState({ kind: "unpaired", notice: null });
      return;
    }
    setRepliedCardId(await readRepliedCardId().catch(() => null));
    try {
      const data = await loadPanelData(pairing);
      setState((prev) => {
        if (prev.kind === "ready" && prev.data.lock?.id !== data.lock?.id) setNextNotice(null);
        return { kind: "ready", pairing, data, error: null };
      });
    } catch (err) {
      if (err instanceof UnpairedError) {
        await clearPairing();
        setState({ kind: "unpaired", notice: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => (prev.kind === "ready" ? { ...prev, error: message } : { kind: "error", notice: message }));
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
    const timer = window.setInterval(() => { refresh().catch(() => undefined); }, REFRESH_MS);
    const onFocus = () => { refresh().catch(() => undefined); };
    window.addEventListener("focus", onFocus);
    const onStorage = () => { refresh().catch(() => undefined); };
    browser.storage.onChanged.addListener(onStorage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      browser.storage.onChanged.removeListener(onStorage);
    };
  }, [refresh]);

  if (state.kind === "loading") {
    return <main className="panel"><p className="muted">Loading…</p></main>;
  }

  if (state.kind === "unpaired") {
    return (
      <main className="panel">
        <h1>X Copilot</h1>
        {state.notice ? <p className="notice" role="status">{state.notice}</p> : null}
        <p>Connect this extension to your desk account to see your approach card here.</p>
        <button
          type="button"
          className="primary"
          onClick={() => { browser.tabs.create({ url: `${DEFAULT_DESK_ORIGIN}/account` }).catch(() => undefined); }}
        >
          Connect on the desk
        </button>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="panel">
        <h1>X Copilot</h1>
        <p className="notice" role="status">{state.notice}</p>
        <p>Your extension is connected, but the approach card could not be loaded.</p>
      </main>
    );
  }

  const card = panelCard(state.data.lock);
  const pace = panelPace(state.data.replyAt, now);
  const pairing = state.pairing;
  const lock = state.data.lock;
  const canAskNext = panelCanAskNext(lock, repliedCardId);

  function askNext() {
    if (!lock) return;
    setAskingNext(true);
    askDeskForNext(pairing, lock.id)
      .then((delivered) => {
        setNextNotice(panelNextNotice(delivered));
        if (delivered) window.setTimeout(() => { refresh().catch(() => undefined); }, 1_500);
      })
      .catch((err: unknown) => setNextNotice(err instanceof Error ? err.message : String(err)))
      .finally(() => setAskingNext(false));
  }

  return (
    <main className="panel">
      <header className="panel-head">
        <h1>X Copilot</h1>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            signOutExtension(pairing)
              .catch(() => undefined)
              .then(() => clearPairing())
              .then(() => setState({ kind: "unpaired", notice: "Signed out." }))
              .catch(() => undefined);
          }}
        >
          Sign out
        </button>
      </header>
      {state.error ? <p className="notice" role="status">{state.error}</p> : null}
      <section className={`card card-${card.kind}`} aria-label="Approach card">
        <p className="verb">{card.verb}</p>
        <h2>{card.title}</h2>
        <p className="detail">{card.detail}</p>
        {pace ? (
          <p className="pace" role="timer" aria-live="off" title={pace.tip}>
            Next reply in {pace.clock}
          </p>
        ) : null}
        <button
          type="button"
          className="primary"
          onClick={() => { openOnX(card.openUrl).catch(() => undefined); }}
        >
          {card.openLabel}
        </button>
        {canAskNext ? (
          <button type="button" className="ghost" disabled={askingNext} onClick={askNext}>
            Next card
          </button>
        ) : null}
        {nextNotice ? <p className="muted small" role="status">{nextNotice}</p> : null}
      </section>
      <label className="toggle">
        <input
          type="checkbox"
          checked={attentionGate}
          onChange={(event) => {
            const on = event.currentTarget.checked;
            setAttentionGate(on);
            writeAttentionGate(on).catch(() => undefined);
          }}
        />
        <span>Reading timer on posts (10 s before you reply)</span>
      </label>
      <p className="muted small">X Copilot never types or posts for you.</p>
    </main>
  );
}
