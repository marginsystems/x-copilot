import { useCallback, useEffect, useRef, useState } from "react";
import type { DeskApproachState, ScoutApproachLockCard } from "../../../../shared/src/scoutApproachLock";
import { browser } from "wxt/browser";
import { UnpairedError } from "../../lib/api";
import { planOpenOnX } from "../../lib/openOnX";
import type { Pairing } from "../../lib/pairing";
import { clearPairing, readPairing } from "../../lib/pairingStore";
import { askDeskForNext, loadPanelData, signOutExtension, type PanelData } from "../../lib/panelData";
import {
  nextFromCardId,
  panelCanAskNext,
  panelDetected,
  panelView,
  panelNextNotice,
  panelPace,
  preloadedNextCard,
  shownAfterRefresh,
  type PendingNext,
} from "../../lib/panelModel";
import { OLDER_SERVER_NOTICE, waitForLockChange } from "../../lib/scoutLock";
import { cardDetected, detectionTag, type CardSince } from "../../lib/detection";
import { readReplySeenAt, trackCardSince } from "../../lib/detectionStore";
import { readRepliedCardId } from "../../lib/repliedCardStore";
import { readAttentionGate, writeAttentionGate } from "../../lib/settingsStore";
import { repliesOnUtcDay, scoutLook } from "../../lib/scout";
import { NEXT_LABEL, nextAskActive, nextClick, type NextAsk } from "../../../../shared/src/nextConfirm";
import { CardSlide, DESK_LINKS, FOOTER_LINKS, GearIcon, NextConfirm, openDeskPage, PanelLinks, PanelShell } from "./PanelParts";
import { Scout } from "./Scout";
import { watchLock } from "../../lib/lockStream";

const REFRESH_MS = 15_000;

type PanelState =
  | { kind: "loading" }
  | { kind: "unpaired"; notice: string | null }
  | { kind: "error"; notice: string }
  | { kind: "ready"; pairing: Pairing; data: PanelData; shown: ScoutApproachLockCard | null; error: string | null };

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
  const [replySeenAtMs, setReplySeenAtMs] = useState<number | null>(null);
  const [since, setSince] = useState<CardSince | null>(null);
  const [nextNotice, setNextNotice] = useState<string | null>(null);
  const [nextBusy, setNextBusy] = useState(false);
  const [nextAsk, setNextAsk] = useState<NextAsk | null>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const restoreNextFocusRef = useRef(false);
  const pendingNextRef = useRef<PendingNext | null>(null);
  const lockVersionRef = useRef(0);
  const shownKeyRef = useRef<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const now = useNow();

  useEffect(() => {
    if (!restoreNextFocusRef.current || !nextButtonRef.current) return;
    restoreNextFocusRef.current = false;
    nextButtonRef.current.focus();
  });

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
    setReplySeenAtMs(await readReplySeenAt().catch(() => null));
    try {
      const lockVersion = lockVersionRef.current;
      const data = await loadPanelData(pairing);
      if (lockVersionRef.current !== lockVersion) return;
      const shown = shownAfterRefresh(pendingNextRef.current, pairing.token, data.lock);
      const viewKey = panelView(shown, data.deskState).key;
      setSince(await trackCardSince(viewKey, Date.now()).catch(() => null));
      if (lockVersionRef.current !== lockVersion) return;
      if (shownKeyRef.current !== viewKey) setNextNotice(null);
      shownKeyRef.current = viewKey;
      setState((prev) => {
        const previousReplies = prev.kind === "ready" && prev.pairing.token === pairing.token ? prev.data.replyAt : [];
        const replyAt = [...data.replyAt, ...previousReplies]
          .filter((at, index, all) => all.indexOf(at) === index)
          .slice(0, 2000);
        return { kind: "ready", pairing, data: { ...data, replyAt }, shown, error: null };
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

  const liveApiBase = state.kind === "ready" ? state.pairing.apiBase : null;
  const liveToken = state.kind === "ready" ? state.pairing.token : null;
  useEffect(() => {
    if (!liveApiBase || !liveToken) return undefined;
    return watchLock({ apiBase: liveApiBase, token: liveToken }, () => { refresh().catch(() => undefined); });
  }, [liveApiBase, liveToken, refresh]);

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
        {state.notice ? <p className="status-line rise" role="status">{state.notice}</p> : null}
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
        <Scout look={scoutLook({ connected: false, repliesToday: 0, stats: null })} />
        <p className="footnote">X Copilot never types or posts for you.</p>
      </PanelShell>
    );
  }

  if (state.kind === "error") {
    return (
      <PanelShell connected>
        <p className="status-line rise" role="status">{state.notice}</p>
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

  const pairing = state.pairing;
  const deskState = state.data.deskState;
  const view = panelView(state.shown, deskState);
  const lock = view.lock;
  const nextUp = state.data.nextUp;
  const card = view.card;
  const pace = panelPace(state.data.replyAt, now);
  const detected = panelDetected({
    view,
    deskState,
    deskCardId: state.data.lock?.id ?? null,
    seenHere: cardDetected({ lock, repliedCardId, replySeenAtMs, since }),
  });
  const canAskNext = panelCanAskNext(view, detected);
  const asking = nextAskActive(nextAsk, { detected, cardKey: view.key });
  if (nextAsk !== null && !asking) setNextAsk(null);
  const tag = view.collecting ? { label: "Waiting for Scout", detected: false } : detectionTag(lock, detected);

  async function show(next: ScoutApproachLockCard | null, nextState: DeskApproachState | null) {
    const nextView = panelView(next, nextState);
    lockVersionRef.current += 1;
    shownKeyRef.current = nextView.key;
    setNextNotice(null);
    setState((prev) => (prev.kind === "ready" ? { ...prev, shown: next } : prev));
    setSince(await trackCardSince(nextView.key, Date.now()).catch(() => null));
    if (!nextView.collecting) await openOnX(nextView.card.openUrl);
  }

  async function findNext(): Promise<string | null> {
    const request = nextFromCardId(lock);
    const taker = await askDeskForNext(pairing, request);
    if (!taker) return panelNextNotice("no_desk");
    const preloaded = taker === "server" ? null : preloadedNextCard(request, nextUp);
    if (preloaded) {
      pendingNextRef.current = { token: pairing.token, request, shown: preloaded.card };
      await show(preloaded.card, null).catch(() => undefined);
    }
    const moved = await waitForLockChange(pairing, request).finally(() => {
      pendingNextRef.current = null;
    });
    if (!moved) {
      if (preloaded) await refresh().catch(() => undefined);
      return panelNextNotice(lock ? "not_moved" : "no_card");
    }
    lockVersionRef.current += 1;
    setState((prev) =>
      prev.kind === "ready"
        ? {
            ...prev,
            data: {
              ...prev.data,
              lock: moved.card,
              nextUp: moved.next,
              deskState: moved.state,
              lockSupported: moved.supported,
            },
          }
        : prev,
    );
    if (!preloaded || moved.card?.id !== preloaded.card?.id) await show(moved.card, moved.state);
    return null;
  }

  function askNext() {
    if (nextBusy) return;
    setNextBusy(true);
    setNextNotice(null);
    findNext()
      .catch((err: unknown) => (err instanceof Error ? err.message : String(err)))
      .then((notice) => {
        if (notice) setNextNotice(notice);
        setNextBusy(false);
      })
      .catch(() => undefined);
  }

  function pressNext() {
    const outcome = nextClick({ detected, cardKey: view.key });
    if (outcome.action === "ask") {
      setNextAsk(outcome.ask);
      return;
    }
    askNext();
  }

  function skipCard() {
    setNextAsk(null);
    askNext();
  }

  function keepWaiting() {
    restoreNextFocusRef.current = true;
    setNextAsk(null);
  }

  const look = scoutLook({
    connected: true,
    repliesToday: repliesOnUtcDay(state.data.replyAt, now),
    stats: state.data.scout ?? null,
  });

  const settingsButton = (
    <button
      type="button"
      className="ghost icon-btn"
      aria-label="Settings"
      aria-pressed={settingsOpen}
      title="Settings"
      onClick={() => setSettingsOpen((open) => !open)}
    >
      <GearIcon />
    </button>
  );

  if (settingsOpen) {
    return (
      <PanelShell connected headSide={settingsButton}>
        <section className="card rise" aria-label="Settings">
          <p className="section-title">Settings</p>
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
            <span>Reading timer on posts</span>
          </label>
          <p className="settings-help">Holds the reply box on x.com for 10 seconds so you read the post first.</p>
          <div className="actions">
            <button type="button" className="primary" onClick={() => setSettingsOpen(false)}>
              Done
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                signOutExtension(pairing)
                  .catch(() => undefined)
                  .then(() => clearPairing())
                  .then(() => {
                    setSettingsOpen(false);
                    setState({ kind: "unpaired", notice: "Signed out." });
                  })
                  .catch(() => undefined);
              }}
            >
              Sign out
            </button>
          </div>
        </section>
        <PanelLinks links={FOOTER_LINKS} />
        <Scout look={look} />
        <p className="footnote">X Copilot never types or posts for you.</p>
      </PanelShell>
    );
  }

  return (
    <PanelShell connected headSide={settingsButton}>
      {state.error ? <p className="status-line rise" role="status">{state.error}</p> : null}
      {state.data.lockSupported ? null : <p className="status-line rise" role="status">{OLDER_SERVER_NOTICE}</p>}
      <CardSlide slideKey={view.key}>
      <section className={`card card-${card.kind}`} aria-label="Approach card">
        <div className="card-head">
          <p className="verb">{card.verb}</p>
          <span className={`detect-tag${tag.detected ? " is-detected" : ""}`} role="status">
            <span className="detect-dot" aria-hidden="true" />
            {tag.label}
          </span>
        </div>
        <h2>{card.title}</h2>
        <p className="detail">{detected ? "Detected. Tap Next for your next one." : card.detail}</p>
        {pace ? (
          <p className="pace" role="timer" aria-live="off" title={pace.tip}>
            <span className="pace-label">Next reply in</span>
            <span className="pace-clock">{pace.clock}</span>
          </p>
        ) : null}
        <div className="actions">
          {asking ? (
            <NextConfirm subject={lock ? "reply" : "post"} onSkip={skipCard} onKeep={keepWaiting} />
          ) : (
            <>
              {detected ? null : (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => { openOnX(card.openUrl).catch(() => undefined); }}
                >
                  {card.openLabel}
                </button>
              )}
              {!detected && card.secondary ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    const url = card.secondary?.url;
                    if (url) openOnX(url).catch(() => undefined);
                  }}
                >
                  {card.secondary.label}
                </button>
              ) : null}
              {canAskNext ? (
                <button
                  type="button"
                  className="primary"
                  ref={nextButtonRef}
                  disabled={nextBusy}
                  onClick={pressNext}
                >
                  {NEXT_LABEL}
                </button>
              ) : null}
            </>
          )}
        </div>
        {nextNotice ? <p className="settings-help rise" role="status">{nextNotice}</p> : null}
      </section>
      </CardSlide>
      <PanelLinks links={FOOTER_LINKS} />
      <Scout look={look} />
      <p className="footnote">X Copilot never types or posts for you.</p>
    </PanelShell>
  );
}
