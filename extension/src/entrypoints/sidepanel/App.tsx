import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { UnpairedError } from "../../lib/api";
import { planOpenOnX } from "../../lib/openOnX";
import type { Pairing } from "../../lib/pairing";
import { clearPairing, readPairing } from "../../lib/pairingStore";
import { askDeskForNext, loadPanelData, signOutExtension, type PanelData } from "../../lib/panelData";
import { panelCanAskNext, panelCard, panelNextNotice, panelPace } from "../../lib/panelModel";
import { OLDER_SERVER_NOTICE, waitForLockChange } from "../../lib/scoutLock";
import { readRepliedCardId } from "../../lib/repliedCardStore";
import { readAttentionGate, writeAttentionGate } from "../../lib/settingsStore";
import { DESK_LINKS, FOOTER_LINKS, openDeskPage, PanelLinks, PanelShell } from "./PanelParts";

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
    return (
      <PanelShell connected={null}>
        <section className="card" aria-busy="true" aria-label="Loading">
          <p className="section-title">Loading</p>
          <div className="skeleton skeleton-title" />
          <div className="skeleton" />
          <div className="skeleton skeleton-short" />
        </section>
      </PanelShell>
    );
  }

  if (state.kind === "unpaired") {
    return (
      <PanelShell connected={false}>
        {state.notice ? <p className="status-line" role="status">{state.notice}</p> : null}
        <section className="card" aria-label="Connect your desk">
          <p className="section-title">Connect your desk</p>
          <p className="detail">Connect this extension to your desk account to see your approach card here.</p>
          <ol className="steps">
            <li>Open Account on xcopilot.dev.</li>
            <li>Click Connect extension.</li>
            <li>Come back here.</li>
          </ol>
          <button type="button" className="primary" onClick={() => openDeskPage("/account")}>
            Open Account
          </button>
        </section>
        <PanelLinks links={DESK_LINKS} />
        <p className="footnote">X Copilot never types or posts for you.</p>
      </PanelShell>
    );
  }

  if (state.kind === "error") {
    return (
      <PanelShell connected>
        <p className="status-line" role="status">{state.notice}</p>
        <section className="card" aria-label="Approach card">
          <p className="section-title">Approach</p>
          <p className="detail">Your extension is connected, but the approach card could not be loaded.</p>
          <button type="button" className="primary" onClick={() => { refresh().catch(() => undefined); }}>
            Retry
          </button>
        </section>
        <PanelLinks links={FOOTER_LINKS} />
      </PanelShell>
    );
  }

  const card = panelCard(state.data.lock);
  const pace = panelPace(state.data.replyAt, now);
  const pairing = state.pairing;
  const lock = state.data.lock;
  const canAskNext = panelCanAskNext(lock, repliedCardId);

  function askNext() {
    if (!lock) return;
    const fromCardId = lock.id;
    setAskingNext(true);
    setNextNotice(null);
    askDeskForNext(pairing, fromCardId)
      .then(async (delivered) => {
        if (!delivered) {
          setNextNotice(panelNextNotice("no_desk"));
          return;
        }
        const moved = await waitForLockChange(pairing, fromCardId);
        if (!moved) {
          setNextNotice(panelNextNotice("not_moved"));
          return;
        }
        setState((prev) =>
          prev.kind === "ready"
            ? { ...prev, data: { ...prev.data, lock: moved.card, lockSupported: moved.supported } }
            : prev,
        );
        await openOnX(panelCard(moved.card).openUrl);
      })
      .catch((err: unknown) => setNextNotice(err instanceof Error ? err.message : String(err)))
      .finally(() => setAskingNext(false));
  }

  const signOut = (
    <button
      type="button"
      className="ghost small-btn"
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
  );

  return (
    <PanelShell connected headSide={signOut}>
      {state.error ? <p className="status-line" role="status">{state.error}</p> : null}
      {state.data.lockSupported ? null : <p className="status-line" role="status">{OLDER_SERVER_NOTICE}</p>}
      <section className={`card card-${card.kind}`} aria-label="Approach card">
        <p className="verb">{card.verb}</p>
        <h2>{card.title}</h2>
        <p className="detail">{card.detail}</p>
        {pace ? (
          <p className="pace" role="timer" aria-live="off" title={pace.tip}>
            <span className="pace-label">Next reply in</span>
            <span className="pace-clock">{pace.clock}</span>
          </p>
        ) : null}
        <div className="actions">
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
        </div>
        {nextNotice ? <p className="settings-help" role="status">{nextNotice}</p> : null}
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
      <PanelLinks links={FOOTER_LINKS} />
      <p className="footnote">X Copilot never types or posts for you.</p>
    </PanelShell>
  );
}
