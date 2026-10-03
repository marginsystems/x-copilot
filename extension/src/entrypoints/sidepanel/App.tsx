import { useCallback, useEffect, useRef, useState } from "react";
import type { ApproachNextRequest } from "../../../../shared/src/approachNext";
import {
  lockMovedAfterNext,
  type ScoutApproachLockCard,
  type ScoutApproachNext,
} from "../../../../shared/src/scoutApproachLock";
import { browser } from "wxt/browser";
import { UnpairedError } from "../../lib/api";
import { planOpenOnX } from "../../lib/openOnX";
import type { Pairing } from "../../lib/pairing";
import { clearPairing, readPairing } from "../../lib/pairingStore";
import { askDeskForNext, loadPanelData, signOutExtension, type PanelData } from "../../lib/panelData";
import { nextFromCardId, panelCanAskNext, panelCard, panelNextNotice, panelPace, preloadedNextCard } from "../../lib/panelModel";
import { OLDER_SERVER_NOTICE, waitForLockChange } from "../../lib/scoutLock";
import { cardDetected, cardKey, detectionTag, type CardSince } from "../../lib/detection";
import { readReplySeenAt, restoreCardSince, trackCardSince } from "../../lib/detectionStore";
import { readRepliedCardId } from "../../lib/repliedCardStore";
import { readAttentionGate, writeAttentionGate } from "../../lib/settingsStore";
import { repliesOnUtcDay, scoutLook } from "../../lib/scout";
import { DESK_LINKS, FOOTER_LINKS, GearIcon, openDeskPage, PanelLinks, PanelShell } from "./PanelParts";
import { Scout } from "./Scout";

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
  const [replySeenAtMs, setReplySeenAtMs] = useState<number | null>(null);
  const [since, setSince] = useState<CardSince | null>(null);
  const [nextNotice, setNextNotice] = useState<string | null>(null);
  const [nextBusy, setNextBusy] = useState<"idle" | "finding" | "confirming">("idle");
  const pendingNextRef = useRef<ApproachNextRequest | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    setReplySeenAtMs(await readReplySeenAt().catch(() => null));
    try {
      const data = await loadPanelData(pairing);
      if (pendingNextRef.current && !lockMovedAfterNext(pendingNextRef.current, data.lock)) return;
      setSince(await trackCardSince(cardKey(data.lock), Date.now()).catch(() => null));
      setState((prev) => {
        if (prev.kind === "ready" && prev.data.lock?.id !== data.lock?.id) setNextNotice(null);
        const previousReplies = prev.kind === "ready" && prev.pairing.token === pairing.token ? prev.data.replyAt : [];
        const replyAt = [...data.replyAt, ...previousReplies]
          .filter((at, index, all) => all.indexOf(at) === index)
          .slice(0, 2000);
        return { kind: "ready", pairing, data: { ...data, replyAt }, error: null };
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
        <Scout look={scoutLook({ connected: false, repliesToday: 0, stats: null })} />
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
  const detected = cardDetected({ lock, repliedCardId, replySeenAtMs, since });
  const tag = detectionTag(lock, detected);

  function askNext() {
    if (pendingNextRef.current) return;
    const request = nextFromCardId(lock);
    const preloaded = preloadedNextCard(request, state.kind === "ready" ? state.data.nextUp : null);
    pendingNextRef.current = request;
    setNextBusy(preloaded ? "confirming" : "finding");
    setNextNotice(null);

    const show = async (card: ScoutApproachLockCard | null, nextUp: ScoutApproachNext | null) => {
      setState((prev) => (prev.kind === "ready" ? { ...prev, data: { ...prev.data, lock: card, nextUp } } : prev));
      setSince(await trackCardSince(cardKey(card), Date.now()).catch(() => null));
      await openOnX(panelCard(card).openUrl);
    };
    const settle = async (notice: string | null) => {
      pendingNextRef.current = null;
      if (notice && preloaded) {
        const nextUp = state.kind === "ready" ? state.data.nextUp : null;
        setState((prev) => (prev.kind === "ready" ? { ...prev, data: { ...prev.data, lock, nextUp } } : prev));
        setSince(since);
        await restoreCardSince(since).catch(() => undefined);
      }
      if (notice) setNextNotice(notice);
      setNextBusy("idle");
    };

    if (preloaded) show(preloaded.card, null).catch(() => undefined);
    askDeskForNext(pairing, request)
      .then(async (delivered) => {
        if (!delivered) return panelNextNotice("no_desk");
        const moved = await waitForLockChange(pairing, request);
        if (!moved) return panelNextNotice(lock ? "not_moved" : "no_card");
        if (preloaded && moved.card?.id === preloaded.card?.id) {
          setState((prev) => (prev.kind === "ready" ? { ...prev, data: { ...prev.data, nextUp: moved.next } } : prev));
          return null;
        }
        await show(moved.card, moved.next);
        return null;
      })
      .then(settle, (err: unknown) => settle(err instanceof Error ? err.message : String(err)))
      .catch(() => undefined);
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
        <section className="card" aria-label="Settings">
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
      {state.error ? <p className="status-line" role="status">{state.error}</p> : null}
      {state.data.lockSupported ? null : <p className="status-line" role="status">{OLDER_SERVER_NOTICE}</p>}
      <section className={`card card-${card.kind}`} aria-label="Approach card">
        <div className="card-head">
          <p className="verb">{card.verb}</p>
          <span className={`detect-tag${tag.detected ? " is-detected" : ""}`} role="status">
            <span className="detect-dot" aria-hidden="true" />
            {tag.label}
          </span>
        </div>
        <h2>{card.title}</h2>
        <p className="detail">{detected ? "Detected. Tap Next card for your next one." : card.detail}</p>
        {pace ? (
          <p className="pace" role="timer" aria-live="off" title={pace.tip}>
            <span className="pace-label">Next reply in</span>
            <span className="pace-clock">{pace.clock}</span>
          </p>
        ) : null}
        <div className="actions">
          {detected ? null : (
            <button
              type="button"
              className="primary"
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
              className={detected ? "primary" : "ghost"}
              disabled={nextBusy !== "idle"}
              onClick={askNext}
            >
              {nextBusy === "finding" ? "Finding next…" : "Next card"}
            </button>
          ) : null}
        </div>
        {nextNotice ? <p className="settings-help" role="status">{nextNotice}</p> : null}
      </section>
      <PanelLinks links={FOOTER_LINKS} />
      <Scout look={look} />
      <p className="footnote">X Copilot never types or posts for you.</p>
    </PanelShell>
  );
}
