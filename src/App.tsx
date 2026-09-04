import { useEffect, useState } from "react";
import {
  loadSettings,
  type AppSettings,
} from "./lib/settings";
import { apiFetch, isLocalHostname } from "./lib/apiBase";
import { authErrorMessage } from "./lib/authErrors";
import { applyTheme, nextTheme, readTheme, type Theme } from "./lib/theme";
import { UserMenu } from "./UserMenu";
import { BootScreen, Landing } from "./Landing";
import { SignInModal } from "./SignInModal";
import { LegalPage } from "./Legal";
import { PricingPage } from "./Pricing";
import { ChangelogPage } from "./Changelog";
import { LearnPage } from "./Learn";
import { LearnHubPage } from "./LearnHub";
import { LearnReplyPage } from "./LearnReply";
import { LearnVolumePage } from "./LearnVolume";
import { LearnGivePage } from "./LearnGive";
import { LearnFollowPage } from "./LearnFollow";
import { CookieConsent } from "./CookieConsent";
import { isLegalKind } from "./lib/legal";
import { isPublicView, viewFromPath } from "./lib/appView";
import { groundedHint } from "./lib/upgradeCta";
import { Onboarding } from "./Onboarding";
import { LinkXGate } from "./LinkXGate";
import { deskNeedsXLink, showDeskXGate } from "./lib/deskGate";
import {
  consumeOnboardingPreviewQuery,
  needsOnboardingWizard,
  readOnboardingAgenda,
  readOnboardingComplete,
} from "./lib/onboarding";
import { OnboardingPreviewBar } from "./OnboardingPreview";
import { AdminPanel } from "./AdminPanel";
import { Analytics } from "./Analytics";
import { Account } from "./Account";
import { VoiceCardPanel, VoiceUnlockToast } from "./VoiceCard";
import { useDeskHistory } from "./desk/useDeskHistory";
import {
  parseVoiceState,
  voiceNeedsXLink,
  type VoiceState,
} from "./lib/voice";
import type { ThreadCard, ThreadsTab } from "./desk/types";
import { ensureActivitySubscribe } from "./desk/watch";
import { DismissModal } from "./desk/DismissModal";
import { MarkDetectModal } from "./desk/MarkDetectModal";
import { Toast } from "./desk/Toast";
import { useMarkDetect } from "./desk/useMarkDetect";
import { useAgendaPersist } from "./desk/useAgendaPersist";
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
import { AppHeader } from "./chrome/AppHeader";
import { MenuDrawer } from "./chrome/MenuDrawer";
import { useMenu } from "./chrome/useMenu";
import { DeskTop } from "./desk/DeskTop";
import { ThreadsTabs } from "./desk/ThreadsTabs";
import { useActivityStrip } from "./desk/useActivityStrip";
import { useCoaching } from "./desk/useCoaching";
import {
  clearDeskBootCache,
  fetchDeskBoot,
  peekDeskBootCache,
  writeDeskBootCache,
  type DeskBootDesk,
} from "./lib/deskBoot";

export default function App() {
  const [agendaReady, setAgendaReady] = useState(false);
  const [onboardingSeedAgenda, setOnboardingSeedAgenda] = useState<
    string | null
  >(null);
  const cachedBoot = peekDeskBootCache();
  const [agenda, setAgenda] = useState(
    () =>
      cachedBoot?.user?.agenda ??
      "Find builders sharing opinions, tradeoffs, or concrete takes on shipping AI / software tools in public. Prefer posts with a clear point of view or a specific technical claim I can agree/disagree with.\nSkip open-ended engagement questions (“what are you shipping?”, “drop your stack”, “who should I follow?”, generic peer polls) even when they mention AI/build-in-public. A lone question with little substance is not interesting.",
  );
  const [status, setStatus] = useState(
    "Scout refuels when Approach is empty.",
  );
  const [threads, setThreads] = useState<ThreadCard[]>(
    () => cachedBoot?.desk?.lastScout.snapshot?.threads ?? [],
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Short mutex for mark/skip/dismiss/settings — not Scout-in-flight. */
  const [actionBusy, setActionBusy] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const {
    interactedIds,
    setInteractedIds,
    interactedHistory,
    setInteractedHistory,
    dismissedHistory,
    setDismissedHistory,
    skippedHistory,
    setSkippedHistory,
    expiredHistory,
    forYouSuggestions,
    forYouProgress,
    forYouExtra,
    dismissedIdsRef,
    skippedIdsRef,
    interactedIdsRef,
    blockedConversationsRef,
    historyStaleRef,
    applyHistoryFromBoot,
    hydrateInteracted,
    hydrateSkipped,
    hydrateDismissed,
    hydrateExpired,
    hydrateForYou,
    keepInCurated,
    actForYou,
    requestExtra,
  } = useDeskHistory({
    setThreads,
    setStatus,
    setActionBusy,
    settings,
  });
  const [threadsTab, setThreadsTab] = useState<ThreadsTab>("curated");
  const {
    activityBucket,
    flightPathOpen,
    deskTopOpen,
    activityStats,
    gamification,
    applyStripFromBoot,
    hydrateActivityStats,
    hydrateGamification,
    onActivityBucket,
    onToggleFlightPath,
    onToggleDeskTop,
  } = useActivityStrip();
  const { coaching, applyCoaching, hydrateCoaching } = useCoaching();
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
    onUtcDay: () => void hydrateVoice(),
  });
  const {
    adminTenants,
    adminBusy,
    adminError,
    loadAdmin,
  } = useAdmin();
  const { menuOpen, menuEntered, openMenu, closeMenu } = useMenu();
  const [signInOpen, setSignInOpen] = useState(false);
  const [onboardingPreview, setOnboardingPreview] = useState(false);
  const [simulateUnlinked, setSimulateUnlinked] = useState(false);
  const [previewReachedLink, setPreviewReachedLink] = useState(false);
  const {
    authUser,
    setAuthUser,
    onboardingDoneLocal,
    authChecked,
    authRequired,
    authNotice,
    setAuthNotice,
    applyAuthUser,
    hydrateAuth,
    startGoogleLogin,
    startXLogin,
    onLogout,
    finishOnboarding,
    setOnboardingDoneLocal,
  } = useAuthSession({
    setAgenda,
    onLoggedOut: closeMenu,
    onOnboardingFinished: () => {
      ensureActivitySubscribe();
      void hydrateVoice({ skipDaily: true });
    },
  });
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
  } = useSettingsDraft({ setSettings, setThreads });
  const {
    searching,
    searchCooldownRemaining,
    grounded,
    sortiesLimit,
    onSearch,
    onStopScout,
    applyLastScoutFromBoot,
    applyScoutLogFromBoot,
    hydrateLastScout,
    hydrateScoutLog,
  } = useScoutRun({
    agenda,
    settings,
    authUser,
    billing,
    setThreads,
    setStatus,
    keepInCurated,
    hydrateInteracted,
    loadBilling,
    hydrateAuth,
    onScoutFinished: () => {
      void hydrateCoaching();
    },
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
    markThread,
    markDetectNote,
    toast,
    openMarkModal,
    closeMarkModal,
  } = useMarkDetect({
    agenda,
    setThreads,
    setExpandedId,
    setInteractedIds,
    setInteractedHistory,
    interactedIdsRef,
    blockedConversationsRef,
    historyStaleRef,
    onInteractionCommitted: () => {
      void hydrateActivityStats();
      void hydrateGamification();
      void hydrateCoaching();
    },
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
    const params = new URLSearchParams(window.location.search);
    const err = authErrorMessage(params.get("auth_error"));
    if (err) {
      setAuthNotice(err);
    } else if (params.get("auth") === "ok") setAuthNotice("Signed in.");
    const checkout = params.get("checkout");
    const sessionId = params.get("session_id");
    if (checkout === "success") {
      setView("usage");
      setBillingNotice("Checkout complete — confirming your plan…");
    } else if (checkout === "cancel") {
      setView("usage");
      setBillingNotice("Checkout canceled.");
    }
    if (params.has("auth_error") || params.has("auth") || params.has("checkout") || params.has("session_id")) {
      params.delete("auth_error");
      params.delete("auth");
      params.delete("checkout");
      params.delete("session_id");
      const path = checkout ? "/usage" : window.location.pathname;
      const next = `${path}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", next);
    }
    void (async () => {
      const applyUser = (user: typeof authUser) => {
        const onboarded = user
          ? user.onboardingCompleted
          : readOnboardingComplete();
        if (user?.agenda) {
          setAgenda(user.agenda);
          setOnboardingSeedAgenda(null);
          readOnboardingAgenda(user.id);
        } else {
          const storedAgenda = readOnboardingAgenda(user?.id);
          if (storedAgenda) {
            setAgenda(storedAgenda);
            if (!onboarded) setOnboardingSeedAgenda(storedAgenda);
          }
        }
        setAgendaReady(true);
        return onboarded;
      };

      const applyDesk = (desk: DeskBootDesk) => {
        applyHistoryFromBoot(desk);
        applyStripFromBoot(desk);
        applyCoaching(desk.coaching);
        applyLastScoutFromBoot(desk.lastScout);
        applyScoutLogFromBoot(desk.scoutLog);
      };

      const refreshAfterPaint = (user: typeof authUser) => {
        void hydrateCoaching();
        void hydrateActivityStats();
        void loadBilling();
        if (user) {
          ensureActivitySubscribe();
          void hydrateVoice();
        }
        if (viewFromPath(window.location.pathname) === "usage" || checkout) {
          void loadUsage();
        }
        if (viewFromPath(window.location.pathname) === "admin" && user?.isAdmin) {
          void loadAdmin();
        }
      };

      const boot = await fetchDeskBoot(settings.dedupeAccounts);
      if (boot.status === "ok") {
        const user = applyAuthUser(boot.payload.user, boot.payload.authRequired);
        if (err && !user) setSignInOpen(true);
        applyUser(user);
        if (boot.payload.desk) {
          applyDesk(boot.payload.desk);
          writeDeskBootCache(boot.payload);
        } else {
          clearDeskBootCache();
        }
        if (checkout === "success" && sessionId) {
          await confirmCheckout(sessionId);
        }
        refreshAfterPaint(user);
        return;
      }

      if (boot.status === "unauthenticated") {
        applyAuthUser(null, boot.authRequired);
        clearDeskBootCache();
        if (err) setSignInOpen(true);
        applyUser(null);
        return;
      }

      clearDeskBootCache();
      const user = await hydrateAuth();
      if (err && !user) setSignInOpen(true);
      const onboarded = applyUser(user);
      await Promise.all([
        hydrateDismissed(),
        hydrateSkipped(),
        hydrateInteracted(),
        hydrateExpired(),
        hydrateForYou(),
        hydrateGamification(),
        onboarded ? hydrateLastScout() : Promise.resolve(),
        hydrateScoutLog(),
      ]);
      if (checkout === "success" && sessionId) {
        await confirmCheckout(sessionId);
      }
      refreshAfterPaint(user);
    })();
  }, []);

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
    void loadUsage(usageWindow);
    void loadBilling();
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
  }, [authUser]);

  function exitOnboardingPreview() {
    setOnboardingPreview(false);
    setSimulateUnlinked(false);
    setPreviewReachedLink(false);
  }

  useEffect(() => {
    if (!markThread && !dismissThread && !signInOpen && !onboardingPreview) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || actionBusy) return;
      if (onboardingPreview) {
        exitOnboardingPreview();
        return;
      }
      if (markThread) closeMarkModal();
      if (dismissThread) closeDismissModal();
      if (signInOpen) {
        setSignInOpen(false);
        setAuthNotice("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markThread, dismissThread, signInOpen, onboardingPreview, actionBusy]);

  const needsXLink = deskNeedsXLink(authUser);
  const booting = !localUi && !authChecked;
  const legalView = isLegalKind(view);
  const pricingView = view === "pricing";
  const changelogView = view === "changelog";
  const learnView = view === "learn";
  const learnWeightsView = view === "learnWeights";
  const learnReplyView = view === "learnReply";
  const learnVolumeView = view === "learnVolume";
  const learnFollowView = view === "learnFollow";
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

  if (booting) {
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
      />

      {menuOpen ? (
        <MenuDrawer entered={menuEntered} onClose={closeMenu}>
          <UserMenu
            view={view}
            theme={theme}
            authUser={authUser}
            needsLogin={needsLogin}
            needsOnboarding={needsOnboarding || showOnboardingPreview}
            onTheme={() => setTheme((t) => nextTheme(t))}
            onLogout={() => void onLogout()}
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

      {legalView ? (
        <main className="app-main app-main-scroll">
          <LegalPage
            kind={view}
            onHome={() => goToView("home")}
            onOther={() => goToView(view === "privacy" ? "terms" : "privacy")}
          />
        </main>
      ) : pricingView ? (
        <main className="app-main app-main-scroll">
          <PricingPage
            signedIn={Boolean(authUser)}
            onHome={() => goToView("home")}
            onSignIn={() => setSignInOpen(true)}
            onOpenDesk={() => goToView("dashboard")}
            onUsage={() => goToView("usage")}
          />
        </main>
      ) : changelogView ? (
        <main className="app-main app-main-scroll">
          <ChangelogPage onHome={() => goToView("home")} />
        </main>
      ) : learnView ? (
        <main className="app-main app-main-scroll">
          <LearnHubPage
            onHome={() => goToView("home")}
            onOpenLesson={(lesson) => goToView(lesson)}
          />
        </main>
      ) : learnWeightsView ? (
        <main className="app-main app-main-scroll">
          <LearnPage
            onHome={() => goToView("home")}
            onCatalog={() => goToView("learn")}
            onOpenLesson={(lesson) => goToView(lesson)}
            onFollow={() => goToView("learnFollow")}
            onReply={() => goToView("learnReply")}
            onVolume={() => goToView("learnVolume")}
          />
        </main>
      ) : learnReplyView ? (
        <main className="app-main app-main-scroll">
          <LearnReplyPage
            onHome={() => goToView("home")}
            onCatalog={() => goToView("learn")}
            onOpenLesson={(lesson) => goToView(lesson)}
            onWeights={() => goToView("learnWeights")}
            onVolume={() => goToView("learnVolume")}
          />
        </main>
      ) : learnVolumeView ? (
        <main className="app-main app-main-scroll">
          <LearnVolumePage
            onHome={() => goToView("home")}
            onCatalog={() => goToView("learn")}
            onOpenLesson={(lesson) => goToView(lesson)}
            onWeights={() => goToView("learnWeights")}
            onReply={() => goToView("learnReply")}
          />
        </main>
      ) : view === "learnGive" ? (
        <main className="app-main app-main-scroll">
          <LearnGivePage goToView={goToView} />
        </main>
      ) : learnFollowView ? (
        <main className="app-main app-main-scroll">
          <LearnFollowPage
            onHome={() => goToView("home")}
            onCatalog={() => goToView("learn")}
            onOpenLesson={(lesson) => goToView(lesson)}
          />
        </main>
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
            onRefresh={() => void loadAdmin()}
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
            setAuthUser(null);
            setAuthNotice("Signed out.");
            goToView("home");
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
          onLoad={(window) => void loadUsage(window)}
          onWindowChange={(window) => {
            setUsageWindow(window);
            void loadUsage(window);
          }}
          onSubscribe={(plan) => void onSubscribe(plan)}
          onManageBilling={() => void onManageBilling()}
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
        <>
        <VoiceUnlockToast
          voice={voice}
          xLinked={authUser?.xLinked}
          hasSession={Boolean(authUser)}
          onOpenSettings={openVoice}
          onLinkX={startXLogin}
        />
        <div className="dashboard">
          <section className="desk">
            <DeskTop
              open={deskTopOpen}
              onToggle={onToggleDeskTop}
              searching={searching}
              status={status}
              flightPathOpen={flightPathOpen}
              activityBucket={activityBucket}
              activityStats={activityStats}
              gamification={gamification}
              interactedHistory={interactedHistory}
              coaching={coaching}
              onToggleFlightPath={onToggleFlightPath}
              onActivityBucket={onActivityBucket}
            />
            <ThreadsTabs
              threadsTab={threadsTab}
              setThreadsTab={setThreadsTab}
              curatedThreads={curatedThreads}
              forYouSuggestions={forYouSuggestions}
              forYouProgress={forYouProgress}
              forYouExtra={forYouExtra}
              coaching={coaching}
              requestExtra={async () => {
                await requestExtra();
                void hydrateCoaching();
              }}
              interactedHistory={interactedHistory}
              skippedHistory={skippedHistory}
              dismissedHistory={dismissedHistory}
              expiredHistory={expiredHistory}
              searching={searching}
              actionBusy={actionBusy}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              interactedIds={interactedIds}
              voice={voice}
              agenda={agenda}
              agendaReady={agendaReady}
              authUser={authUser}
              setVoice={setVoice}
              actForYou={async (id, action) => {
                await actForYou(id, action);
                void hydrateCoaching();
              }}
              onOpenVoice={openVoice}
              onOpenSettings={openSettings}
              onOpenUsage={openUsage}
              onLinkX={startXLogin}
              grounded={grounded}
              groundedLine={
                grounded && !searching
                  ? groundedHint({
                      limit: sortiesLimit ?? 0,
                      planKey: billing?.plan_key,
                      firstWeek: Boolean(billing?.first_week_pulse),
                    })
                  : null
              }
              searchCooldownRemaining={searchCooldownRemaining}
              onSearch={onSearch}
              onStopScout={onStopScout}
              onMark={openMarkModal}
              onSkip={onSkip}
              onDismiss={openDismissModal}
              onRefreshCoaching={hydrateCoaching}
              setActionBusy={setActionBusy}
              setStatus={setStatus}
              onForkBeats={(beats) => {
                applyCoaching({
                  dayUtc: coaching?.dayUtc ?? "",
                  nextAction: coaching?.nextAction ?? null,
                  missions: coaching?.missions ?? [],
                  beats,
                });
              }}
            />
          </section>
        </div>
        </>
      )}
        </main>
      ) : null}

      <MarkDetectModal
        thread={markThread}
        note={markDetectNote}
        onClose={closeMarkModal}
      />
      <Toast toast={toast} />
      <DismissModal
        thread={dismissThread}
        reason={dismissReason}
        busy={actionBusy}
        setReason={setDismissReason}
        onConfirm={() => void confirmDismiss()}
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
