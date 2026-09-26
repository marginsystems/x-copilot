import { useEffect, useRef, useState } from "react";
import {
  loadSettings,
  type AppSettings,
} from "./lib/settings";
import { apiFetch, isLocalHostname } from "./lib/apiBase";
import { applyTheme, nextTheme, readTheme, type Theme } from "./lib/theme";
import { UserMenu } from "./UserMenu";
import { BootScreen, Landing } from "./Landing";
import { SignInModal } from "./SignInModal";
import { CookieConsent } from "./CookieConsent";
import { isPublicView } from "./lib/appView";
import { Onboarding } from "./Onboarding";
import { LinkXGate } from "./LinkXGate";
import { deskNeedsXLink, showDeskXGate } from "./lib/deskGate";
import {
  consumeOnboardingPreviewQuery,
  needsOnboardingWizard,
  readOnboardingComplete,
} from "./lib/onboarding";
import { OnboardingPreviewBar } from "./OnboardingPreview";
import { VoiceCardPanel } from "./VoiceCard";
import { useDeskHistory } from "./desk/useDeskHistory";
import {
  parseVoiceState,
  voiceNeedsXLink,
  type VoiceState,
} from "./lib/voice";
import type { ThreadCard, ThreadsTab } from "./desk/types";
import { ensureActivitySubscribe } from "./desk/watch";
import { DismissModal } from "./desk/DismissModal";
import { useAgendaPersist } from "./desk/useAgendaPersist";
import { useDeskBoot } from "./desk/useDeskBoot";
import { useScoutFamiliarity } from "./desk/useScoutFamiliarity";
import { useScoutRun } from "./desk/useScoutRun";
import { useSkipDismiss } from "./desk/useSkipDismiss";
import { SettingsForm } from "./settings/SettingsForm";
import { useSettingsDraft } from "./settings/useSettingsDraft";
import { UsagePage } from "./usage/UsagePage";
import { useUsage } from "./usage/useUsage";
import { useAdmin } from "./admin/useAdmin";
import { useAuthSession } from "./auth/useAuthSession";
import { useBilling } from "./billing/useBilling";
import { useViewRouting } from "./routing/useViewRouting";
import { PublicPages } from "./routing/PublicPages";
import { AppHeader } from "./chrome/AppHeader";
import { MenuDrawer } from "./chrome/MenuDrawer";
import { useMenu } from "./chrome/useMenu";
import { useActivityStrip } from "./desk/useActivityStrip";
import { useCoaching } from "./desk/useCoaching";
import { SessionBoundary } from "./auth/session";
import { lazyRoute } from "./routing/lazyRoute";

const AdminPanel = lazyRoute(() => import("./AdminPanel").then((m) => ({ default: m.AdminPanel })));
const Analytics = lazyRoute(() => import("./Analytics").then((m) => ({ default: m.Analytics })));
const Account = lazyRoute(() => import("./Account").then((m) => ({ default: m.Account })));
const DeskView = lazyRoute(() => import("./desk/DeskView"));

export default function App() {
  return (
    <SessionBoundary>
      <SessionApp />
    </SessionBoundary>
  );
}

function SessionApp() {
  const [agenda, setAgenda] = useState(
    () =>
      "Find builders sharing opinions, tradeoffs, or concrete takes on shipping AI / software tools in public. Prefer posts with a clear point of view or a specific technical claim I can agree/disagree with.\nSkip open-ended engagement questions (“what are you shipping?”, “drop your stack”, “who should I follow?”, generic peer polls) even when they mention AI/build-in-public. A lone question with little substance is not interesting.",
  );
  const [status, setStatus] = useState("");
  const [threads, setThreads] = useState<ThreadCard[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Short mutex for skip/dismiss/settings — not Scout-in-flight. */
  const [actionBusy, setActionBusy] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const {
    authUser,
    invalidateSession,
    setAuthUser,
    onboardingDoneLocal,
    authChecked,
    authRequired,
    authNotice,
    setAuthNotice,
    applyAuthUser,
    startGoogleLogin,
    startXLogin,
    onLogout,
    finishOnboarding,
    setOnboardingDoneLocal,
  } = useAuthSession({
    setAgenda,
    onLoggedOut: () => closeMenu(),
    onOnboardingFinished: () => {
      ensureActivitySubscribe();
      hydrateVoice({ skipDaily: true }).catch((err) => setStatus(err instanceof Error ? err.message : String(err)));
    },
  });
  const verifiedOwnerId = authUser?.id ?? null;
  const {
    scoutFamiliarity,
    applyScoutFamiliarityFromBoot,
    hydrateScoutFamiliarity,
  } = useScoutFamiliarity(verifiedOwnerId);
  const {
    interactedIds,
    interactedHistory,
    interactedRetainedHistory,
    interactedTotal,
    interactedPage,
    changeInteractedPage,
    dismissedHistory,
    setDismissedHistory,
    skippedHistory,
    setSkippedHistory,
    expiredHistory,
    forYouSuggestions,
    dismissedIdsRef,
    skippedIdsRef,
    blockedConversationsRef,
    historyStaleRef,
    applyHistoryFromBoot,
    hydrateInteracted,
    pollInteracted,
    keepInCurated,
    actForYou,
  } = useDeskHistory({
    setThreads,
    setStatus,
    setActionBusy,
    settings,
    onHydrated: () => { hydrateScoutFamiliarity().catch((err) => setStatus(err instanceof Error ? err.message : String(err))); },
  }, verifiedOwnerId);
  const [threadsTab, setThreadsTab] = useState<ThreadsTab>("curated");
  const {
    activityBucket,
    flightPathOpen,
    deskTopOpen,
    activityStats,
    gamification,
    applyStripFromBoot,
    hydrateActivityStats,
    onActivityBucket,
    onToggleFlightPath,
    onToggleDeskTop,
  } = useActivityStrip(verifiedOwnerId);
  const { coaching, applyCoaching, hydrateCoaching } = useCoaching(verifiedOwnerId);
  const {
    view,
    setView,
    consentOpen,
    setConsentOpen,
    chooseConsent,
    goToView,
  } = useViewRouting();
  const {
    usageWindow,
    setUsageWindow,
    usage,
    usageBusy,
    usageStatus,
    loadUsage,
  } = useUsage();
  const {
    billing,
    billingNotice,
    setBillingNotice,
    checkoutPlan,
    portalBusy,
    loadBilling,
    confirmCheckout,
    onSubscribe,
    onManageBilling,
  } = useBilling({
    onUtcDay: () => { hydrateVoice().catch((err) => setStatus(err instanceof Error ? err.message : String(err))); },
  });
  const {
    adminTenants,
    adminBusy,
    adminError,
    loadAdmin,
  } = useAdmin();
  const { menuOpen, menuEntered, openMenu, closeMenu } = useMenu();
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [onboardingPreview, setOnboardingPreview] = useState(false);
  const [simulateUnlinked, setSimulateUnlinked] = useState(false);
  const [previewReachedLink, setPreviewReachedLink] = useState(false);
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document === "undefined" ? "dark" : readTheme(),
  );
  const localUi = isLocalHostname(
    typeof window !== "undefined" ? window.location.hostname : "localhost",
  );
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const voiceError: string | null = voice?.lastError ?? null;
  const {
    settingsDraft,
    setSettingsDraft,
    settingsStatus,
    resetSettingsDraft,
    onSaveSettings,
  } = useSettingsDraft({ setSettings });
  const {
    searching,
    scoutStage,
    scoutLine,
    applyLastScoutFromBoot,
  } = useScoutRun({
    pollingEnabled: authChecked && (authUser
      ? authUser.onboardingCompleted
      : !authRequired && (onboardingDoneLocal || readOnboardingComplete())),
    settings,
    threadCount: threads.filter((thread) => keepInCurated(thread)).length,
    setThreads,
    setStatus,
    keepInCurated,
  });
  const { agendaReady, deskBootReady, onboardingSeedAgenda } = useDeskBoot({
    dedupeAccounts: settings.dedupeAccounts,
    setAgenda,
    setAuthNotice,
    setBillingNotice,
    setView,
    setSignInOpen,
    applyAuthUser,
    applyDesk: (desk) => {
      applyHistoryFromBoot(desk);
      applyStripFromBoot(desk);
      applyScoutFamiliarityFromBoot(desk);
      if (desk.coaching !== undefined) applyCoaching(desk.coaching);
      if (desk.lastScout !== undefined) applyLastScoutFromBoot(desk.lastScout);
    },
    confirmCheckout,
    hydrateCoaching,
    hydrateActivityStats,
    loadBilling,
    hydrateVoice,
    loadUsage,
    loadAdmin,
    hydrateScoutFamiliarity,
  });
  const needsLogin = authChecked && authRequired && !authUser && !localUi;
  const needsOnboarding = needsOnboardingWizard({
    needsLogin,
    onboardingDoneLocal,
    authUser,
    localComplete: readOnboardingComplete(),
  });
  const { onAgendaBlur } = useAgendaPersist({
    agenda,
    enabled: agendaReady && Boolean(authUser) && !needsOnboarding,
    authUser,
    setAuthUser,
  });
  const {
    dismissThread,
    dismissReason,
    setDismissReason,
    openDismissModal,
    closeDismissModal,
    onSkip,
    confirmDismiss,
  } = useSkipDismiss({
    setActionBusy,
    setStatus,
    setThreads,
    setExpandedId,
    setSkippedHistory,
    setDismissedHistory,
    skippedIdsRef,
    dismissedIdsRef,
    blockedConversationsRef,
    historyStaleRef,
    onActionSucceeded: () => { hydrateScoutFamiliarity().catch((err) => setStatus(err instanceof Error ? err.message : String(err))); },
  });
  const curatedThreads = threads.filter((t) => keepInCurated(t));

  async function hydrateVoice(_opts?: { skipDaily?: boolean }) {
    try {
      const res = await apiFetch("/api/voice");
      if (!res.ok) return;
      const parsed = parseVoiceState(await res.json());
      if (!parsed) return;
      setVoice(parsed);
    } catch {
      // Sidecar may be offline on first paint — voice stays hidden.
    }
  }

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

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

  function openSettings() {
    resetSettingsDraft(settings);
    goToView("settings");
    closeMenu();
  }

  function openAccount() {
    goToView("account");
    closeMenu();
  }

  function openUsage() {
    goToView("usage");
    closeMenu();
    loadUsage(usageWindow).catch((err) => setStatus(err instanceof Error ? err.message : String(err)));
    loadBilling().catch((err) => setStatus(err instanceof Error ? err.message : String(err)));
  }

  function openAnalytics() {
    goToView("analytics");
    closeMenu();
  }

  function openVoice() {
    goToView("voice");
    closeMenu();
  }

  useEffect(() => {
    if (!authUser?.isAdmin) return;
    const { open, nextSearch } = consumeOnboardingPreviewQuery(
      window.location.search,
      true,
    );
    if (!open) return;
    setOnboardingPreview(true);
    const next = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    window.history.replaceState({}, "", next);
  }, [authUser?.isAdmin]);

  useEffect(() => {
    if (authUser) return;
    setOnboardingPreview(false);
    setSimulateUnlinked(false);
    setPreviewReachedLink(false);
    setOnboardingDoneLocal(false);
  }, [authUser, setOnboardingDoneLocal]);

  function exitOnboardingPreview() {
    setOnboardingPreview(false);
    setSimulateUnlinked(false);
    setPreviewReachedLink(false);
  }

  useEffect(() => {
    if (!dismissThread && !signInOpen && !onboardingPreview) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || actionBusy) return;
      if (onboardingPreview) {
        exitOnboardingPreview();
        return;
      }
      if (dismissThread) closeDismissModal();
      if (signInOpen) {
        setSignInOpen(false);
        setAuthNotice("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissThread, signInOpen, onboardingPreview, actionBusy, closeDismissModal, setAuthNotice]);

  const needsXLink = deskNeedsXLink(authUser);
  const booting = !localUi && !authChecked;
  const publicView = isPublicView(view);
  const showOnboardingPreview =
    onboardingPreview && Boolean(authUser?.isAdmin) && !publicView;
  const showLanding =
    !publicView &&
    !needsOnboarding &&
    !showOnboardingPreview &&
    (view === "home" || needsLogin);
  const deskXGate = showDeskXGate({
    needsXLink,
    needsLogin,
    needsOnboarding,
    legalView: publicView,
    showLanding,
    view,
  });
  const showGateChrome =
    (showLanding || needsOnboarding || deskXGate || showOnboardingPreview) &&
    !publicView;

  if (booting && !publicView) {
    return (
      <div className="app app-gate">
        <BootScreen />
      </div>
    );
  }

  return (
    <div className={showGateChrome ? "app app-gate" : "app"}>
      <AppHeader
        gate={showGateChrome}
        menuOpen={menuOpen}
        menuEntered={menuEntered}
        authUser={authUser}
        onHome={() => {
          closeMenu();
          goToView("home");
        }}
        onToggleMenu={() => {
          if (menuOpen && menuEntered) closeMenu();
          else openMenu();
        }}
        menuToggleRef={menuToggleRef}
      />

      {menuOpen ? (
        <MenuDrawer
          entered={menuEntered}
          onClose={closeMenu}
          openerRef={menuToggleRef}
        >
          <UserMenu
            view={view}
            theme={theme}
            authUser={authUser}
            needsLogin={needsLogin}
            needsOnboarding={needsOnboarding || showOnboardingPreview}
            onTheme={() => setTheme((t) => nextTheme(t))}
            onLogout={() => { onLogout().catch((err) => setStatus(err instanceof Error ? err.message : String(err))); }}
            onSignIn={() => {
              closeMenu();
              setSignInOpen(true);
            }}
            onDesk={() => {
              closeMenu();
              goToView("dashboard");
            }}
            onX={startXLogin}
            onAnalytics={openAnalytics}
            onVoice={openVoice}
            needsXLink={authUser ? voiceNeedsXLink(voice, authUser.xLinked) : false}
            onUsage={openUsage}
            onAccount={openAccount}
            onSettings={openSettings}
            onPrivacySettings={() => {
              setConsentOpen(true);
              closeMenu();
            }}
          />
        </MenuDrawer>
      ) : null}

      {publicView ? (
        <PublicPages
          view={view}
          signedIn={Boolean(authUser)}
          goToView={goToView}
          onSignIn={() => setSignInOpen(true)}
        />
      ) : showLanding ? (
        <Landing
          notice={authNotice}
          signedIn={Boolean(authUser)}
          onSignIn={() => setSignInOpen(true)}
          onOpenDesk={() => goToView("dashboard")}
        />
      ) : null}

      {publicView ? null : showOnboardingPreview ? (
        <>
          <OnboardingPreviewBar
            simulateUnlinked={simulateUnlinked}
            onSimulateUnlinked={setSimulateUnlinked}
            onExit={exitOnboardingPreview}
          />
          <Onboarding
            mode="preview"
            persist={false}
            userId={authUser?.id ?? null}
            hidden={previewReachedLink && simulateUnlinked}
            onComplete={() => {
              if (simulateUnlinked) {
                setPreviewReachedLink(true);
                return;
              }
              exitOnboardingPreview();
              goToView("admin");
            }}
          />
          {previewReachedLink && simulateUnlinked ? (
            <LinkXGate
              kicker="Set up your desk"
              title="Link X to take off"
              lede="Voice reads the account you log into. Sign in with X — you cannot type a handle. If you already signed in with X, you are linked."
            />
          ) : null}
        </>
      ) : needsOnboarding ? (
        <Onboarding
          mode={authUser ? "real" : "local"}
          persist={Boolean(authUser)}
          userId={authUser?.id ?? null}
          initialAgenda={onboardingSeedAgenda}
          onComplete={finishOnboarding}
        />
      ) : deskXGate ? (
        <LinkXGate title="Link X to take off" onLinkX={startXLogin} />
      ) : null}

      {!publicView &&
      !showLanding &&
      !needsOnboarding &&
      !deskXGate &&
      !showOnboardingPreview ? (
        <main
          className={
            view === "dashboard"
              ? "app-main"
              : "app-main app-main-scroll"
          }
        >
      {authNotice ? (
        <p className="status auth-notice" role="status">
          {authNotice}
        </p>
      ) : null}

      {view === "admin" ? (
        authUser?.isAdmin ? (
          <AdminPanel
            tenants={adminTenants}
            busy={adminBusy}
            error={adminError}
            onBack={() => goToView("dashboard")}
            onRefresh={() => { loadAdmin().catch((err) => setStatus(err instanceof Error ? err.message : String(err))); }}
            onPreviewOnboarding={() => {
              setSimulateUnlinked(false);
              setOnboardingPreview(true);
            }}
          />
        ) : (
          <section className="panel settings-pane">
            <div className="settings-head">
              <h2>Admin</h2>
              <button
                type="button"
                className="ghost"
                onClick={() => goToView("dashboard")}
              >
                Back
              </button>
            </div>
            <p className="status danger">This desk is operator-only.</p>
          </section>
        )
      ) : null}

      {view === "analytics" ? (
        <Analytics onBack={() => goToView("dashboard")} />
      ) : null}

      {view === "account" ? (
        <Account
          onBack={() => goToView("dashboard")}
          onGoogle={startGoogleLogin}
          onX={startXLogin}
          onSignedOut={() => {
            if (invalidateSession()) goToView("home");
          }}
        />
      ) : null}

      {view === "voice" ? (
        <section className="panel settings-pane">
          <div className="settings-head">
            <h2>Voice</h2>
            <button
              type="button"
              className="ghost"
              onClick={() => goToView("dashboard")}
            >
              Back
            </button>
          </div>
          <p className="status settings-lede">
            {authUser && voiceNeedsXLink(voice, authUser.xLinked)
              ? "Link X first — Voice reads your latest public posts at setup and hourly. Scout takeoffs are what spend credits."
              : `Suggest reply uses this card. We ingest your latest public posts at setup and hourly — you cannot refresh it by hand. Unlock is ${voice?.unlockAt ?? 100} posts. Scout takeoffs are what spend credits.`}
          </p>
          <VoiceCardPanel
            voice={voice}
            busy={false}
            error={voiceError}
            needsXLink={authUser ? voiceNeedsXLink(voice, authUser.xLinked) : false}
            onLinkX={startXLogin}
          />
        </section>
      ) : null}

      {view === "usage" ? (
        <UsagePage
          usageWindow={usageWindow}
          usage={usage}
          busy={usageBusy}
          status={usageStatus}
          billing={billing}
          billingNotice={billingNotice}
          checkoutPlan={checkoutPlan}
          portalBusy={portalBusy}
          onBack={() => goToView("dashboard")}
          onLoad={(window) => { loadUsage(window).catch((err) => setStatus(err instanceof Error ? err.message : String(err))); }}
          onWindowChange={(window) => {
            setUsageWindow(window);
            loadUsage(window).catch((err) => setStatus(err instanceof Error ? err.message : String(err)));
          }}
          onSubscribe={(plan) => { onSubscribe(plan).catch((err) => setStatus(err instanceof Error ? err.message : String(err))); }}
          onManageBilling={() => { onManageBilling().catch((err) => setStatus(err instanceof Error ? err.message : String(err))); }}
        />
      ) : null}

      {view === "usage" ||
      view === "admin" ||
      view === "analytics" ||
      view === "account" ||
      view === "voice" ? null : view === "settings" ? (
        <SettingsForm
          authUser={authUser}
          draft={settingsDraft}
          setDraft={setSettingsDraft}
          agenda={agenda}
          onAgendaChange={setAgenda}
          onAgendaBlur={onAgendaBlur}
          status={settingsStatus}
          onBack={() => goToView("dashboard")}
          onOpenAccount={() => goToView("account")}
          onLinkX={startXLogin}
          onSave={onSaveSettings}
        />
      ) : (
        <DeskView
          toast={{
            voice,
            xLinked: authUser?.xLinked,
            hasSession: Boolean(authUser),
            onOpenSettings: openVoice,
            onLinkX: startXLogin,
          }}
          top={{
            open: deskTopOpen,
            onToggle: onToggleDeskTop,
            flightPathOpen,
            activityBucket,
            activityStats,
            gamification,
            scoutFamiliarity,
            interactedRetainedHistory,
            usableScoutCount: curatedThreads.filter(
              (thread) => !interactedIds.has(thread.id),
            ).length,
            coaching,
            status,
            onToggleFlightPath,
            onActivityBucket,
          }}
          tabs={{
            threadsTab,
            setThreadsTab,
            curatedThreads,
            forYouSuggestions,
            coaching,
            interactedHistory,
            interactedRetainedHistory,
            interactedTotal,
            interactedPage,
            onInteractedPageChange: changeInteractedPage,
            skippedHistory,
            dismissedHistory,
            expiredHistory,
            searching,
            scoutStage,
            scoutLine,
            actionBusy,
            expandedId,
            setExpandedId,
            interactedIds,
            voice,
            agenda,
            agendaReady,
            deskBootReady,
            authUser,
            dismissThread,
            setVoice,
            actForYou: async (id, action) => {
              const succeeded = await actForYou(id, action);
              hydrateCoaching().catch((err) => setStatus(err instanceof Error ? err.message : String(err)));
              return succeeded;
            },
            onOpenVoice: openVoice,
            onOpenSettings: openSettings,
            onLinkX: startXLogin,
            onSkip,
            onDismiss: openDismissModal,
            onRefreshCoaching: hydrateCoaching,
            onHydrateInteracted: hydrateInteracted,
            onPollInteracted: pollInteracted,
          }}
        />
      )}
        </main>
      ) : null}

      <DismissModal
        thread={dismissThread}
        reason={dismissReason}
        busy={actionBusy}
        setReason={setDismissReason}
        onConfirm={() => { confirmDismiss().catch((err) => setStatus(err instanceof Error ? err.message : String(err))); }}
        onClose={closeDismissModal}
      />

      <SignInModal
        open={signInOpen}
        notice={authNotice}
        onClose={() => {
          setSignInOpen(false);
          setAuthNotice("");
        }}
        onGoogle={startGoogleLogin}
        onX={startXLogin}
      />

      <CookieConsent open={consentOpen} onChoose={chooseConsent} />
    </div>
  );
}
