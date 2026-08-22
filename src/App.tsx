import { useEffect, useRef, useState } from "react";
import {
  SCOUT_SEARCH_TIMELINE,
  SCOUT_STAGE_RANK,
  SCOUT_STAGE_TICK_MS,
  formatScoutFailure,
  isScoutGateError,
  scoutFlightLine,
  scoutStageMessage,
  type ScoutStageId,
} from "./lib/scoutStages";
import {
  loadSettings,
  saveSettings,
  type AppSettings,
  clampMaxThreadChars,
  clampTargetCoolThreads,
  normalizePreferredLanguage,
  threadHasExcludedTag,
  PREFERRED_LANGUAGES,
  DEFAULT_SETTINGS,
} from "./lib/settings";
import { ExcludedAccountsField } from "./ExcludedAccountsField";
import { ExcludedTagsField } from "./ExcludedTagsField";
import { formatAbsoluteTime, formatTimeAgo } from "./lib/timeAgo";
import { ScoutPixelField } from "./ScoutPixelField";
import { sortThreadsByCreatedAtNewest } from "./lib/threadSort";
import {
  emptyActivityStats,
  fetchActivityStats,
  type ActivityBucket,
  type ActivityStats,
} from "./lib/activityStats";
import {
  emptyGamificationStats,
  fetchGamification,
  type GamificationStats,
} from "./lib/gamification";
import { ActivityChart } from "./ActivityChart";
import { apiFetch, apiUrl, isLocalHostname } from "./lib/apiBase";
import { authErrorMessage } from "./lib/authErrors";
import { applyTheme, nextTheme, readTheme, type Theme } from "./lib/theme";
import { HeaderAvatar, UserMenu } from "./UserMenu";
import { BootScreen, Landing } from "./Landing";
import { SignInModal } from "./SignInModal";
import { LegalPage } from "./Legal";
import { CookieConsent } from "./CookieConsent";
import { isLegalKind, SITE_ORIGIN } from "./lib/legal";
import { pathFromView, viewFromPath, type AppView } from "./lib/appView";
import {
  readConsent,
  writeConsent,
  type ConsentChoice,
} from "./lib/consent";
import { bootAnalytics, trackPageView } from "./lib/analytics";
import { Onboarding } from "./Onboarding";
import { LinkXGate } from "./LinkXGate";
import { deskNeedsXLink, showDeskXGate } from "./lib/deskGate";
import { readOnboardingAgenda, readOnboardingComplete } from "./lib/onboarding";
import { BillingPanel, type BillingMe, type PaidPlanKey } from "./BillingPanel";
import { AdminPanel, type AdminTenantRow } from "./AdminPanel";
import { Analytics } from "./Analytics";
import { Account } from "./Account";
import { SuggestLocked, VoiceCardPanel, VoiceUnlockToast } from "./VoiceCard";
import { SuggestPane } from "./SuggestPane";
import { useDeskHistory } from "./desk/useDeskHistory";
import {
  parseVoiceState,
  voiceNeedsXLink,
  type VoiceState,
} from "./lib/voice";
import type { AuthSessionUser } from "./auth/types";
import {
  appendThreadsById,
  coolProgressLabel,
  scoutProgressPrefix,
  threadHasExcludedAuthor,
} from "./desk/threadHelpers";
import type {
  ScoutLogEntry,
  ScoutStreamEvent,
  ThreadCard,
  ThreadsTab,
} from "./desk/types";
import {
  ensureActivitySubscribe,
  watchDeskThreads,
} from "./desk/watch";
import {
  DismissedRow,
  ExpiredRow,
  InteractedRow,
  SkippedRow,
} from "./desk/HistoryRows";
import { SuggestedRow } from "./desk/SuggestedRow";
import { ThreadRow } from "./desk/ThreadRow";
import { DismissModal } from "./desk/DismissModal";
import { MarkDetectModal } from "./desk/MarkDetectModal";
import { Toast } from "./desk/Toast";
import { useMarkDetect } from "./desk/useMarkDetect";
import { useSkipDismiss } from "./desk/useSkipDismiss";
import type { UsageSummaryResponse, UsageWindow } from "./usage/types";

/** Hard-filter candidate bucket size sent on each Scout run. */
const SCOUT_BUCKET_SIZE = 20;

/** Always occupies a count slot so hydrate cannot grow the tab pills. */
function ThreadsTabCount({ n }: { n: number }) {
  return (
    <span
      className={n > 0 ? "threads-tab-count" : "threads-tab-count is-empty"}
      aria-hidden={n === 0}
    >
      {n > 0 ? `(${n})` : "(0)"}
    </span>
  );
}

/** Matches server SCOUT_COOLDOWN_MS — one Search every 15s after a run ends. */
const SEARCH_COOLDOWN_MS = 15_000;

export default function App() {
  const [agenda, setAgenda] = useState(
    "Find builders sharing opinions, tradeoffs, or concrete takes on shipping AI / software tools in public. Prefer posts with a clear point of view or a specific technical claim I can agree/disagree with.\nSkip open-ended engagement questions (“what are you shipping?”, “drop your stack”, “who should I follow?”, generic peer polls) even when they mention AI/build-in-public. A lone question with little substance is not interesting.",
  );
  const [status, setStatus] = useState(
    "On the ground — set an agenda and take off.",
  );
  const [threads, setThreads] = useState<ThreadCard[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Short mutex for mark/skip/dismiss/settings — not Scout-in-flight. */
  const [actionBusy, setActionBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [scoutLog, setScoutLog] = useState<ScoutLogEntry[]>([]);
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
    dismissedIdsRef,
    skippedIdsRef,
    interactedIdsRef,
    blockedConversationsRef,
    hydrateInteracted,
    hydrateSkipped,
    hydrateDismissed,
    hydrateExpired,
    hydrateForYou,
    keepInCurated,
    actForYou,
  } = useDeskHistory({
    setThreads,
    setStatus,
    setActionBusy,
    excludedTags: settings.excludedTags,
    excludedAccounts: settings.excludedAccounts,
  });
  const [threadsTab, setThreadsTab] = useState<ThreadsTab>("curated");
  const [activityBucket, setActivityBucket] = useState<ActivityBucket>("day");
  const [flightPathOpen, setFlightPathOpen] = useState(() => {
    try {
      const stored = sessionStorage.getItem("x-copilot-flight-path-open");
      if (stored === "0") return false;
      if (stored === "1") return true;
    } catch {
      /* private mode */
    }
    return (
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 700px)").matches
    );
  });
  const [activityStats, setActivityStats] = useState<ActivityStats>(() =>
    emptyActivityStats("day"),
  );
  const [gamification, setGamification] = useState<GamificationStats>(() =>
    emptyGamificationStats(),
  );
  const activityBucketRef = useRef<ActivityBucket>("day");
  /** In-flight toggle target; may diverge from applied `activityBucketRef`. */
  const activityRequestBucketRef = useRef<ActivityBucket>("day");
  /** Monotonic token so out-of-order gamification responses don't regress the chip. */
  const gamificationRequestSeqRef = useRef(0);
  const [view, setView] = useState<AppView>(() =>
    typeof window === "undefined" ? "home" : viewFromPath(window.location.pathname),
  );
  const [consent, setConsent] = useState<ConsentChoice | null>(() =>
    typeof window === "undefined" ? null : readConsent(),
  );
  const [consentOpen, setConsentOpen] = useState(
    () => (typeof window === "undefined" ? false : readConsent() === null),
  );
  const [usageWindow, setUsageWindow] = useState<UsageWindow>("7d");
  const [usage, setUsage] = useState<UsageSummaryResponse | null>(null);
  const [usageBusy, setUsageBusy] = useState(false);
  /** Monotonic token so out-of-order usage responses can't show the wrong window. */
  const usageRequestSeqRef = useRef(0);
  const [usageStatus, setUsageStatus] = useState("");
  const [billing, setBilling] = useState<BillingMe | null>(null);
  const [billingNotice, setBillingNotice] = useState("");
  const [checkoutPlan, setCheckoutPlan] = useState<PaidPlanKey | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [adminTenants, setAdminTenants] = useState<AdminTenantRow[] | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [menuEntered, setMenuEntered] = useState(false);
  const [authUser, setAuthUser] = useState<AuthSessionUser | null>(null);
  const [onboardingDoneLocal, setOnboardingDoneLocal] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authRequired, setAuthRequired] = useState(true);
  const [authNotice, setAuthNotice] = useState("");
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document === "undefined" ? "dark" : readTheme(),
  );
  const localUi = isLocalHostname(
    typeof window !== "undefined" ? window.location.hostname : "localhost",
  );
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const voiceError: string | null = voice?.lastError ?? null;
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(() =>
    loadSettings(),
  );
  const [settingsStatus, setSettingsStatus] = useState("");
  const [searchCooldownUntil, setSearchCooldownUntil] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
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
    onInteractionCommitted: () => {
      void hydrateActivityStats();
      void hydrateGamification();
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
  });
  const abortRef = useRef<AbortController | null>(null);
  const searchingRef = useRef(0);
  const coolProgressRef = useRef({
    cool: 0,
    target: DEFAULT_SETTINGS.targetCoolThreads,
  });
  const flightStageRef = useRef<ScoutStageId>("planning");
  const serverStageRef = useRef<ScoutStageId | null>(null);
  const lastFlightCountsRef = useRef<{
    candidates?: number;
    bucketSize?: number;
  }>({});
  const staleHydration = useRef(false);
  const menuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchCooldownRemaining = Math.max(
    0,
    Math.ceil((searchCooldownUntil - nowMs) / 1000),
  );
  const sortiesLeft = billing?.sorties?.remaining;
  const sortiesLimit = billing?.sorties?.limit;
  const grounded =
    billing?.sorties != null && billing.sorties.can_fly === false;
  const searchBlocked =
    searching ||
    searchCooldownRemaining > 0 ||
    grounded ||
    deskNeedsXLink(authUser);

  function clearMenuCloseTimer() {
    if (menuCloseTimer.current) {
      clearTimeout(menuCloseTimer.current);
      menuCloseTimer.current = null;
    }
  }

  function openMenu() {
    clearMenuCloseTimer();
    setMenuOpen(true);
    setMenuEntered(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setMenuEntered(true));
    });
  }

  function closeMenu() {
    if (!menuOpen) return;
    setMenuEntered(false);
    clearMenuCloseTimer();
    menuCloseTimer.current = setTimeout(() => {
      setMenuOpen(false);
      menuCloseTimer.current = null;
    }, 240);
  }

  function pushScoutLine(line: string, stage?: string) {
    const message = line.trim();
    if (!message) return;
    const atMs = Date.now();
    const entry: ScoutLogEntry = {
      at: new Date(atMs).toISOString(),
      message,
      ...(stage ? { stage } : {}),
    };
    setNowMs(atMs);
    setScoutLog((prev) => {
      const last = prev[prev.length - 1];
      if (last?.message === message) {
        const bumped = [...prev];
        bumped[bumped.length - 1] = {
          ...last,
          at: entry.at,
          ...(stage ? { stage } : {}),
        };
        return bumped;
      }
      return [...prev, entry].slice(-1000);
    });
    void apiFetch("/api/scout/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }).catch(() => {
      /* sidecar may be offline — keep in-memory */
    });
  }

  function applyScoutEvent(ev: ScoutStreamEvent) {
    const stage = (ev.stage ?? "planning") as ScoutStageId;
    if (typeof ev.coolCount === "number" && ev.coolCount > 0) {
      coolProgressRef.current.cool = ev.coolCount;
    }
    if (typeof ev.targetCool === "number") {
      coolProgressRef.current.target = ev.targetCool;
    }
    let message = ev.message || scoutStageMessage(stage);
    // Prefer server bucket copy; avoid double-prefixing Cand./Cool lines.
    if (
      !/^Cand\.?\b/i.test(message) &&
      !/^Candidates\b/i.test(message) &&
      !/^Cool\b/i.test(message) &&
      !/^0 cool/i.test(message)
    ) {
      const prefix = scoutProgressPrefix(ev);
      if (
        prefix &&
        (stage === "searching" ||
          stage === "filtering" ||
          stage === "triaging" ||
          stage === "partial")
      ) {
        message = `${prefix} · ${message}`;
      }
    }
    const counts = {
      cool: coolProgressRef.current.cool,
      target: coolProgressRef.current.target,
      candidates: ev.candidates ?? lastFlightCountsRef.current.candidates,
      bucketSize: ev.bucketSize ?? lastFlightCountsRef.current.bucketSize,
    };
    if (typeof ev.candidates === "number") {
      lastFlightCountsRef.current.candidates = ev.candidates;
    }
    if (typeof ev.bucketSize === "number") {
      lastFlightCountsRef.current.bucketSize = ev.bucketSize;
    }
    serverStageRef.current = stage;
    const incomingRank = SCOUT_STAGE_RANK[stage];
    const shownRank = SCOUT_STAGE_RANK[flightStageRef.current];
    const shownStage =
      stage === "error" ||
      stage === "done" ||
      incomingRank >= shownRank
        ? stage
        : flightStageRef.current;
    flightStageRef.current = shownStage;
    setStatus(
      shownStage === "error"
        ? message
        : scoutFlightLine(shownStage, counts),
    );
    pushScoutLine(message, stage);
  }

  async function hydrateScoutLog() {
    try {
      const res = await apiFetch("/api/scout/log");
      if (!res.ok) return;
      const data = (await res.json()) as { entries?: ScoutLogEntry[] };
      const entries = Array.isArray(data.entries)
        ? data.entries.filter(
            (e) =>
              e &&
              typeof e.message === "string" &&
              typeof e.at === "string",
          )
        : [];
      setScoutLog((prev) =>
        prev.length > 0 ? prev : entries.slice(-1000),
      );
    } catch {
      /* ignore */
    }
  }

  function onStopScout() {
    abortRef.current?.abort();
  }

  async function hydrateActivityStats(
    bucket: ActivityBucket = activityBucketRef.current,
  ) {
    const next = await fetchActivityStats(bucket);
    if (!next) return;
    // Ignore stale responses if a newer toggle request is in flight.
    if (bucket !== activityRequestBucketRef.current) return;
    // Commit the applied bucket only after a successful fetch so a failed
    // toggle cannot silently flip the chart on a later mark refresh.
    activityBucketRef.current = bucket;
    setActivityBucket(bucket);
    setActivityStats(next);
  }

  async function hydrateGamification() {
    const seq = ++gamificationRequestSeqRef.current;
    const next = await fetchGamification();
    if (seq !== gamificationRequestSeqRef.current) return;
    if (!next) return;
    setGamification(next);
  }

  function onActivityBucket(next: ActivityBucket) {
    activityRequestBucketRef.current = next;
    void hydrateActivityStats(next);
  }

  function onToggleFlightPath() {
    setFlightPathOpen((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem("x-copilot-flight-path-open", next ? "1" : "0");
      } catch {
        /* private mode */
      }
      return next;
    });
  }

  const curatedThreads = threads.filter((t) => keepInCurated(t));

  async function hydrateLastScout() {
    try {
      const res = await apiFetch(`/api/scout/last?dedupeAccounts=${settings.dedupeAccounts}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok?: boolean;
        empty?: boolean;
        snapshot?: {
          savedAt: string;
          agenda?: string;
          queries?: string[];
          threads?: ThreadCard[];
          message?: string;
          pipelineCounts?: {
            raw: number;
            afterDedupe: number;
            afterCooldown: number;
            afterSelfReply?: number;
            afterLinks?: number;
            afterLength: number;
            afterTriage: number;
          };
        };
      };
      if (!data.ok || data.empty || !data.snapshot) return;
      if (staleHydration.current) return;
      const list = Array.isArray(data.snapshot.threads)
        ? data.snapshot.threads
        : [];
      if (typeof data.snapshot.agenda === "string" && data.snapshot.agenda.trim()) {
        setAgenda(data.snapshot.agenda);
      }
      const filtered = list.filter((t) => keepInCurated(t));
      setThreads(filtered);
      watchDeskThreads(filtered);
      const when =
        formatAbsoluteTime(data.snapshot.savedAt) ||
        formatTimeAgo(data.snapshot.savedAt) ||
        "earlier";
      const pc = data.snapshot.pipelineCounts;
      const funnel = pc
        ? ` (${[
            pc.raw,
            pc.afterDedupe,
            pc.afterCooldown,
            ...(typeof pc.afterSelfReply === "number" ? [pc.afterSelfReply] : []),
            ...(typeof pc.afterLinks === "number" ? [pc.afterLinks] : []),
            pc.afterLength,
            pc.afterTriage,
          ].join(" → ")})`
        : "";
      setStatus(
        `Restored ${filtered.length} threads${funnel} from ${when}.`,
      );
    } catch {
      // Sidecar may be offline on first paint — ignore.
    }
  }

  async function hydrateAuth(): Promise<AuthSessionUser | null> {
    try {
      const res = await apiFetch("/api/auth/me", {
        signal: AbortSignal.timeout(8000),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        authRequired?: boolean;
        user?: {
          id: string;
          email: string | null;
          displayName: string | null;
          avatarUrl: string | null;
          onboardingCompleted?: boolean;
          agenda?: string | null;
          xUsername?: string | null;
          xLinked?: boolean;
          xCanPost?: boolean;
          isAdmin?: boolean;
        };
      };
      setAuthRequired(data.authRequired ?? true);
      if (res.ok && data.ok && data.user?.id) {
        const user: AuthSessionUser = {
          id: data.user.id,
          email: data.user.email,
          displayName: data.user.displayName,
          avatarUrl: data.user.avatarUrl,
          onboardingCompleted: data.user.onboardingCompleted !== false,
          agenda:
            typeof data.user.agenda === "string" && data.user.agenda.trim()
              ? data.user.agenda
              : null,
          xUsername:
            typeof data.user.xUsername === "string" && data.user.xUsername.trim()
              ? data.user.xUsername.replace(/^@+/, "")
              : null,
          xLinked: Boolean(data.user.xLinked),
          xCanPost: Boolean(data.user.xCanPost),
          isAdmin: Boolean(data.user.isAdmin),
        };
        setAuthUser(user);
        return user;
      }
      setAuthUser(null);
      return null;
    } catch {
      setAuthUser(null);
      return null;
    } finally {
      setAuthChecked(true);
    }
  }

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
      const user = await hydrateAuth();
      if (err && !user) setSignInOpen(true);
      const onboarded = user
        ? user.onboardingCompleted
        : readOnboardingComplete();
      if (user?.agenda) {
        setAgenda(user.agenda);
      } else {
        const storedAgenda = readOnboardingAgenda(user?.id);
        if (storedAgenda) setAgenda(storedAgenda);
      }
      await hydrateDismissed();
      await hydrateSkipped();
      await hydrateInteracted();
      await hydrateActivityStats();
      await hydrateGamification();
      await hydrateExpired();
      await hydrateForYou();
      if (onboarded) await hydrateLastScout();
      await hydrateScoutLog();
      if (checkout === "success" && sessionId) {
        await confirmCheckout(sessionId);
      }
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
    })();
    const onPop = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    bootAnalytics(consent);
  }, [consent]);

  /** Last path a page_view was sent for, so a re-render can't double-count a landing. */
  const lastTrackedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (consent !== "accepted") {
      lastTrackedPathRef.current = null;
      return;
    }
    const path = window.location.pathname;
    if (path === lastTrackedPathRef.current) return;
    lastTrackedPathRef.current = path;
    trackPageView(path);
  }, [consent, view]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const now = new Date();
      const nextUtcDay = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
      );
      timer = setTimeout(() => {
        void loadBilling();
        void hydrateVoice();
        arm();
      }, Math.max(0, nextUtcDay - Date.now()) + 500);
    };
    arm();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const canonical = `${SITE_ORIGIN}${pathFromView(view)}`;
    document.title =
      view === "privacy"
        ? "Privacy Policy — x-copilot"
        : view === "terms"
          ? "Terms of Service — x-copilot"
          : "x-copilot — independent research desk";
    document
      .querySelector<HTMLLinkElement>('link[rel="canonical"]')
      ?.setAttribute("href", canonical);
    document
      .querySelector<HTMLMetaElement>('meta[property="og:url"]')
      ?.setAttribute("content", canonical);
  }, [view]);

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

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (searchCooldownUntil <= Date.now()) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => {
      const t = Date.now();
      setNowMs(t);
      if (t >= searchCooldownUntil) {
        window.clearInterval(id);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [searchCooldownUntil]);

  useEffect(() => {
    if (!searching) return;
    let tick = 0;
    const id = window.setInterval(() => {
      tick += 1;
      const nextIdx = Math.min(tick, SCOUT_SEARCH_TIMELINE.length - 1);
      const next = SCOUT_SEARCH_TIMELINE[nextIdx];
      if (!next) return;
      const server = serverStageRef.current;
      if (server && SCOUT_STAGE_RANK[server] >= SCOUT_STAGE_RANK[next]) {
        return;
      }
      if (SCOUT_STAGE_RANK[next] <= SCOUT_STAGE_RANK[flightStageRef.current]) {
        return;
      }
      flightStageRef.current = next;
      setStatus(
        scoutFlightLine(next, {
          cool: coolProgressRef.current.cool,
          target: coolProgressRef.current.target,
          ...lastFlightCountsRef.current,
        }),
      );
    }, SCOUT_STAGE_TICK_MS);
    return () => window.clearInterval(id);
  }, [searching]);

  // Keep scout-log / cooldown "time ago" labels fresh (1s while live or logged).
  useEffect(() => {
    if (!searching && scoutLog.length === 0) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [searching, scoutLog.length > 0]);

  useEffect(() => {
    return () => clearMenuCloseTimer();
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      setMenuEntered(false);
      return;
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setMenuEntered(true));
    });
    return () => cancelAnimationFrame(id);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  function openSettings() {
    setSettingsDraft(settings);
    setSettingsStatus("");
    goToView("settings");
    closeMenu();
  }

  function openAccount() {
    goToView("account");
    closeMenu();
  }

  function startGoogleLogin() {
    window.location.href = apiUrl("/api/auth/google");
  }

  function startXLogin() {
    window.location.href = apiUrl("/api/auth/x");
  }

  async function onLogout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* still clear local */
    }
    setAuthUser(null);
    setAuthNotice("Signed out.");
    closeMenu();
  }

  function finishOnboarding(agenda: string) {
    setAgenda(agenda);
    setOnboardingDoneLocal(true);
    setAuthUser((prev) =>
      prev
        ? {
            ...prev,
            onboardingCompleted: true,
            agenda,
          }
        : prev,
    );
    ensureActivitySubscribe();
    void hydrateVoice({ skipDaily: true });
  }

  function chooseConsent(choice: ConsentChoice) {
    writeConsent(choice);
    setConsent(choice);
    setConsentOpen(false);
  }

  function goToView(next: AppView) {
    setView(next);
    const path = pathFromView(next);
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
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

  async function loadBilling() {
    try {
      const res = await apiFetch("/api/billing/me");
      const data = (await res.json()) as BillingMe;
      if (!res.ok) {
        setBillingNotice(data.message || data.error || `Billing failed (${res.status})`);
        return;
      }
      setBilling(data);
    } catch (err) {
      setBillingNotice(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmCheckout(sessionId: string) {
    try {
      const res = await apiFetch("/api/stripe/checkout/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = (await res.json()) as { ok?: boolean; plan_key?: string; error?: string; message?: string };
      if (!res.ok) {
        setBillingNotice(data.message || data.error || "Could not confirm checkout yet. Refresh in a moment.");
        return;
      }
      setBillingNotice(
        data.plan_key
          ? `You're on ${data.plan_key}. Credits reset each UTC month.`
          : "Subscription active.",
      );
      await loadBilling();
    } catch (err) {
      setBillingNotice(err instanceof Error ? err.message : String(err));
    }
  }

  async function onSubscribe(plan: PaidPlanKey) {
    setCheckoutPlan(plan);
    setBillingNotice("");
    try {
      const res = await apiFetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json()) as {
        url?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.url) {
        setBillingNotice(data.message || data.error || `Checkout failed (${res.status})`);
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      setBillingNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckoutPlan(null);
    }
  }

  async function onManageBilling() {
    setPortalBusy(true);
    setBillingNotice("");
    try {
      const res = await apiFetch("/api/stripe/portal", { method: "POST" });
      const data = (await res.json()) as {
        url?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.url) {
        setBillingNotice(data.message || data.error || `Portal failed (${res.status})`);
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      setBillingNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setPortalBusy(false);
    }
  }

  async function loadAdmin() {
    setAdminBusy(true);
    setAdminError("");
    try {
      const res = await apiFetch("/api/admin/tenants");
      const data = (await res.json()) as {
        ok?: boolean;
        tenants?: AdminTenantRow[];
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setAdminTenants(null);
        setAdminError(data.message || data.error || `Admin failed (${res.status})`);
        return;
      }
      setAdminTenants(data.tenants ?? []);
    } catch (err) {
      setAdminTenants(null);
      setAdminError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdminBusy(false);
    }
  }

  async function loadUsage(window: UsageWindow = usageWindow) {
    const seq = ++usageRequestSeqRef.current;
    setUsageBusy(true);
    setUsageStatus("");
    try {
      const res = await apiFetch(
        `/api/usage?window=${encodeURIComponent(window)}`,
      );
      const data = (await res.json()) as UsageSummaryResponse;
      if (seq !== usageRequestSeqRef.current) return;
      if (!res.ok || data.ok === false) {
        setUsage(null);
        setUsageStatus(data.message || data.error || `Usage failed (${res.status})`);
        return;
      }
      setUsage(data);
      setUsageWindow(data.window ?? window);
    } catch (err) {
      if (seq !== usageRequestSeqRef.current) return;
      setUsage(null);
      setUsageStatus(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === usageRequestSeqRef.current) setUsageBusy(false);
    }
  }

  function persistFilterSettings() {
    const next = saveSettings(settingsDraft);
    setSettings(next);
    setSettingsDraft(next);
    setThreads((prev) =>
      prev.filter(
        (t) =>
          !threadHasExcludedTag(t, next.excludedTags) &&
          !threadHasExcludedAuthor(t, next.excludedAccounts),
      ),
    );
    return next;
  }

  function onSaveSettings() {
    persistFilterSettings();
    setSettingsStatus(
      "Saved — filters apply to For You now and the next Scout.",
    );
  }

  async function onSearch() {
    if (deskNeedsXLink(authUser)) {
      const line = formatScoutFailure(
        "Link X with the official login before Take off.",
        { soft: true },
      );
      setStatus(line);
      pushScoutLine(line, "error");
      return;
    }
    if (Date.now() < searchingRef.current) {
      if (isFinite(searchingRef.current)) {
        const waitSec = Math.ceil((searchingRef.current - Date.now()) / 1000);
        const line = formatScoutFailure(
          `Wait ${waitSec}s before starting Scout again.`,
          { soft: true },
        );
        setStatus(line);
        pushScoutLine(line, "error");
      }
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    searchingRef.current = Infinity;
    staleHydration.current = true;

    const targetCool = clampTargetCoolThreads(settings.targetCoolThreads);
    coolProgressRef.current = { cool: 0, target: targetCool };
    flightStageRef.current = "planning";
    serverStageRef.current = null;
    lastFlightCountsRef.current = {};

    setSearching(true);
    // Keep existing thread rows; partials + done append by id across runs.
    setExpandedId(null);
    pushScoutLine("── Take off ──", "planning");
    applyScoutEvent({
      stage: "planning",
      message: scoutStageMessage("planning"),
      coolCount: 0,
      targetCool,
    });

    try {
      const res = await apiFetch("/api/scout/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({
          agenda,
          targetCool,
          bucketSize: SCOUT_BUCKET_SIZE,
          filters: {
            maxThreadChars: settings.maxThreadChars,
            dropArticles: settings.dropArticles,
            dropEmDashes: settings.dropEmDashes,
            dropAutomatedAccounts: settings.dropAutomatedAccounts,
            dedupeAccounts: settings.dedupeAccounts,
            preferredLanguage: settings.preferredLanguage,
            excludedTags: settings.excludedTags,
            excludedAccounts: settings.excludedAccounts,
          },
        }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const fallback = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        if (fallback.error === "x_link_required") {
          await hydrateAuth();
        }
        const detail =
          fallback.message ||
          fallback.error ||
          (!res.body ? "empty response body" : `HTTP ${res.status}`);
        const soft = isScoutGateError(res.status, fallback);
        const line = formatScoutFailure(detail, { soft });
        setStatus(line);
        pushScoutLine(line, "error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const stream = {
        doneEvent: null as ScoutStreamEvent | null,
        sawError: false,
      };

      const handleEvent = (ev: ScoutStreamEvent) => {
        if (ev.stage === "done") {
          stream.doneEvent = ev;
          applyScoutEvent(ev);
          return;
        }
        if (ev.stage === "error") {
          applyScoutEvent(ev);
          stream.sawError = true;
          return;
        }
        applyScoutEvent(ev);
        if (ev.stage === "partial" && ev.threads?.length) {
          const incoming = (ev.threads ?? []).filter((t) => keepInCurated(t));
          watchDeskThreads(incoming);
          setThreads((prev) => appendThreadsById(prev, incoming));
        }
      };

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
          handleEvent(ev);
        }
      }

      if (buffer.trim()) {
        try {
          handleEvent(JSON.parse(buffer.trim()) as ScoutStreamEvent);
        } catch {
          /* ignore trailing junk */
        }
      }

      if (stream.doneEvent) {
        const doneEvent = stream.doneEvent;
        const qs = doneEvent.queries ?? [];
        const list = doneEvent.threads ?? [];
        const incoming = list.filter((t) => keepInCurated(t));
        watchDeskThreads(incoming);
        // Append this run’s cool threads; do not wipe prior Scout loops.
        setThreads((prev) => appendThreadsById(prev, incoming));
        setExpandedId(null);
        await hydrateInteracted();
        const progress = coolProgressLabel(
          doneEvent.coolCount ?? list.length,
          doneEvent.targetCool ?? targetCool,
          targetCool,
        );
        const reason = doneEvent.stopReason
          ? ` · stop: ${doneEvent.stopReason}`
          : "";
        const qLabel = qs.length ? qs.map((q) => `"${q}"`).join(", ") : "(none)";
        const summary =
          `${progress}${reason} — ${qLabel}` +
          (doneEvent.triageWarning ? ` · ${doneEvent.triageWarning}` : "") +
          (doneEvent.cooldownWarning ? ` · ${doneEvent.cooldownWarning}` : "") +
          (doneEvent.linkWarning ? ` · ${doneEvent.linkWarning}` : "") +
          (doneEvent.emDashWarning ? ` · ${doneEvent.emDashWarning}` : "") +
          (doneEvent.automatedWarning ? ` · ${doneEvent.automatedWarning}` : "") +
          (doneEvent.excludedAccountWarning
            ? ` · ${doneEvent.excludedAccountWarning}`
            : "") +
          (doneEvent.lengthWarning ? ` · ${doneEvent.lengthWarning}` : "");
        setStatus(scoutStageMessage("done"));
        pushScoutLine(summary);
      } else if (!stream.sawError) {
        const line = formatScoutFailure("stream ended without results");
        setStatus(line);
        pushScoutLine(line, "error");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Keep partials already in state; merge any cools persisted mid-run.
        try {
          const res = await apiFetch(
            `/api/scout/last?dedupeAccounts=${settings.dedupeAccounts}`,
          );
          if (res.ok) {
            const data = (await res.json()) as {
              ok?: boolean;
              empty?: boolean;
              snapshot?: { threads?: ThreadCard[]; queries?: string[] };
            };
            if (data.ok && !data.empty && data.snapshot?.threads?.length) {
              setThreads((prev) =>
                appendThreadsById(
                  prev,
                  data.snapshot!.threads!.filter((t) => keepInCurated(t)),
                ),
              );
            }
          }
        } catch {
          /* sidecar may be offline — keep in-memory cools */
        }
        // Still cool down in finally so Stop / unmount cannot bypass the gate.
        const { cool, target } = coolProgressRef.current;
        const summary = `Cool ${cool}/${target} · stop: aborted`;
        setStatus(scoutStageMessage("done"));
        pushScoutLine(summary);
      } else {
        const line = formatScoutFailure(
          "Sidecar offline — run ./pm2-manager.sh restart or npm run dev:server",
        );
        setStatus(line);
        pushScoutLine(line, "error");
      }
    } finally {
      if (abortRef.current === ac) {
        const until = Date.now() + SEARCH_COOLDOWN_MS;
        searchingRef.current = until;
        setSearching(false);
        setSearchCooldownUntil(until);
        setNowMs(Date.now());
        void loadBilling();
        setStatus((prev) => {
          if (/^Wait \d+s before (starting Scout|searching) again/.test(prev)) {
            return prev;
          }
          if (/^Hold short/.test(prev) || /^Grounded/.test(prev)) {
            return prev;
          }
          if (
            prev.startsWith("Scout failed:") ||
            prev.startsWith("Sidecar offline") ||
            prev.startsWith("Couldn't land") ||
            /^A Scout run is already in progress/.test(prev)
          ) {
            return `${prev} · Hold short ${Math.ceil(SEARCH_COOLDOWN_MS / 1000)}s.`;
          }
          return prev;
        });
      }
    }
  }

  useEffect(() => {
    if (!markThread && !dismissThread && !signInOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || actionBusy) return;
      if (markThread) closeMarkModal();
      if (dismissThread) closeDismissModal();
      if (signInOpen) {
        setSignInOpen(false);
        setAuthNotice("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markThread, dismissThread, signInOpen, actionBusy]);

  const needsLogin = authChecked && authRequired && !authUser && !localUi;
  const needsOnboarding =
    !needsLogin &&
    !onboardingDoneLocal &&
    (authUser
      ? authUser.onboardingCompleted === false &&
        !readOnboardingComplete(authUser.id)
      : !readOnboardingComplete());
  const needsXLink = deskNeedsXLink(authUser);
  const booting = !localUi && !authChecked;
  const legalView = isLegalKind(view);
  const showLanding =
    !legalView && !needsOnboarding && (view === "home" || needsLogin);
  const deskXGate = showDeskXGate({
    needsXLink,
    needsLogin,
    needsOnboarding,
    legalView,
    showLanding,
    view,
  });
  const showGateChrome =
    (showLanding || needsOnboarding || deskXGate) && !legalView;

  if (booting) {
    return (
      <div className="app app-gate">
        <BootScreen />
      </div>
    );
  }

  return (
    <div className={showGateChrome ? "app app-gate" : "app"}>
      <header className={showGateChrome ? "brand brand-gate" : "brand"}>
        <div className="brand-bar">
          <a
            className="brand-lockup"
            href="/"
            aria-label="Home"
            onClick={(e) => {
              if (
                e.metaKey ||
                e.ctrlKey ||
                e.shiftKey ||
                e.altKey ||
                e.button !== 0
              ) {
                return;
              }
              e.preventDefault();
              closeMenu();
              goToView("home");
            }}
          >
            <img
              className="brand-mark"
              src="/favicon.svg"
              width={22}
              height={22}
              alt=""
            />
            <div className="brand-copy">
              <h1>x-copilot</h1>
            </div>
          </a>
          <button
            type="button"
            className={
              menuOpen && menuEntered
                ? "menu-toggle is-open"
                : "menu-toggle is-avatar"
            }
            aria-label={menuOpen && menuEntered ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen && menuEntered}
            onClick={() => {
              if (menuOpen && menuEntered) closeMenu();
              else openMenu();
            }}
          >
            {menuOpen && menuEntered ? (
              <svg
                className="menu-toggle-icon"
                viewBox="0 0 24 24"
                width="20"
                height="20"
                aria-hidden="true"
              >
                <path
                  d="M6 6l12 12M18 6L6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="square"
                />
              </svg>
            ) : (
              <HeaderAvatar
                user={authUser}
                handle={authUser?.xUsername ?? null}
              />
            )}
          </button>
        </div>
      </header>

      {menuOpen ? (
        <div className={menuEntered ? "menu-root is-open" : "menu-root"}>
          <button
            type="button"
            className="menu-backdrop"
            aria-label="Close menu"
            onClick={closeMenu}
          />
          <aside
            className={menuEntered ? "menu-sheet is-open" : "menu-sheet"}
            role="dialog"
            aria-modal="true"
            aria-label="User menu"
          >
            <UserMenu
              view={view}
              theme={theme}
              authUser={authUser}
              needsLogin={needsLogin}
              needsOnboarding={needsOnboarding}
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
          </aside>
        </div>
      ) : null}

      {legalView ? (
        <main className="app-main app-main-scroll">
          <LegalPage
            kind={view}
            onHome={() => goToView("home")}
            onOther={() => goToView(view === "privacy" ? "terms" : "privacy")}
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

      {legalView ? null : needsOnboarding ? (
        <Onboarding
          persist={Boolean(authUser)}
          userId={authUser?.id ?? null}
          needsXLink={needsXLink}
          onLinkX={startXLogin}
          onComplete={finishOnboarding}
        />
      ) : deskXGate ? (
        <LinkXGate onLinkX={startXLogin} />
      ) : null}

      {!legalView && !showLanding && !needsOnboarding && !deskXGate ? (
        <main
          className={
            view === "dashboard" ? "app-main" : "app-main app-main-scroll"
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
        <section className="panel settings-pane usage-pane">
          <div className="settings-head">
            <h2>Usage & Billing</h2>
            <button
              type="button"
              className="ghost"
              onClick={() => goToView("dashboard")}
            >
              Back
            </button>
          </div>
          <p className="status settings-lede">
            Start free with 1,500 credits a month — no credit card. Unused
            credits do not roll over. Paid plans are billed by Mergestorm, Inc.
          </p>
          <BillingPanel
            billing={billing}
            busy={usageBusy}
            notice={billingNotice}
            checkoutPlan={checkoutPlan}
            portalBusy={portalBusy}
            onSubscribe={(plan) => void onSubscribe(plan)}
            onManage={() => void onManageBilling()}
          />
          <div className="usage-toolbar">
            <label className="settings-field usage-window">
              <span>Window</span>
              <select
                className="settings-select"
                value={usageWindow}
                disabled={usageBusy}
                onChange={(e) => {
                  const next = e.target.value as UsageWindow;
                  setUsageWindow(next);
                  void loadUsage(next);
                }}
              >
                <option value="24h">Last 24h</option>
                <option value="7d">Last 7 days</option>
                <option value="all">All time</option>
              </select>
            </label>
            <button
              type="button"
              className="ghost"
              disabled={usageBusy}
              onClick={() => void loadUsage(usageWindow)}
            >
              {usageBusy ? "Loading…" : "Refresh"}
            </button>
          </div>
          {usageStatus ? <p className="status danger">{usageStatus}</p> : null}
          {usage?.creditsDepletedRecent ? (
            <p className="usage-banner">
              Scout could not finish — a platform read limit was hit. Try again
              shortly.
            </p>
          ) : null}
          {usage ? (
            <>
              <div className="usage-stats usage-stats-3">
                <div className="usage-stat">
                  <span className="usage-stat-label">Credits used</span>
                  <strong className="usage-stat-value">
                    {usage.creditsUsed ?? 0}
                  </strong>
                </div>
                <div className="usage-stat">
                  <span className="usage-stat-label">Remaining</span>
                  <strong className="usage-stat-value">
                    {usage.remaining ?? 0}
                  </strong>
                </div>
                <div className="usage-stat">
                  <span className="usage-stat-label">Calls</span>
                  <strong className="usage-stat-value">{usage.calls ?? 0}</strong>
                </div>
              </div>
              <p className="settings-help">{usage.note}</p>
              <h3 className="usage-log-title">Usage logs</h3>
              {(usage.recent?.length ?? 0) === 0 ? (
                <p className="status">No usage recorded in this window yet.</p>
              ) : (
                <div className="usage-log">
                  <table>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Activity</th>
                        <th>Credits</th>
                        <th>Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(usage.recent ?? []).map((row) => (
                        <tr key={row.id}>
                          <td>{new Date(row.at).toLocaleString()}</td>
                          <td>
                            {row.activity}
                            {row.error ? (
                              <span className="usage-error"> {row.error}</span>
                            ) : null}
                          </td>
                          <td>{row.credits}</td>
                          <td>
                            {row.remaining === null || row.remaining === undefined
                              ? "—"
                              : row.remaining}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </section>
      ) : null}

      {view === "usage" ||
      view === "admin" ||
      view === "analytics" ||
      view === "account" ||
      view === "voice" ? null : view === "settings" ? (
        <section className="panel settings-pane">
          <div className="settings-head">
            <h2>Settings</h2>
            <button
              type="button"
              className="ghost"
              onClick={() => goToView("dashboard")}
            >
              Back
            </button>
          </div>
          <p className="status settings-lede">
            Filter prefs apply on the next Scout search. X is linked on Account
            through official X login — you cannot type a handle here.
          </p>
          <div className="settings-grid">
            <div className="settings-field settings-field-wide">
              <span>X account</span>
              <p className="settings-help">
                {authUser?.xLinked && authUser.xUsername
                  ? `@${authUser.xUsername} — change it on Account via X login.`
                  : "Required. Link X with the official login."}
              </p>
              {authUser?.xLinked ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => goToView("account")}
                >
                  Account
                </button>
              ) : (
                <button type="button" className="ghost" onClick={startXLogin}>
                  Link X
                </button>
              )}
            </div>
            <label className="settings-field">
              <span>Max post characters</span>
              <input
                type="number"
                min={120}
                max={2000}
                step={1}
                value={settingsDraft.maxThreadChars}
                onChange={(e) =>
                  setSettingsDraft((prev) => ({
                    ...prev,
                    maxThreadChars: clampMaxThreadChars(
                      e.target.value === ""
                        ? DEFAULT_SETTINGS.maxThreadChars
                        : Number(e.target.value),
                    ),
                  }))
                }
              />
              <span className="settings-help">
                Skip the candidate and replies under a parent over this length.
              </span>
            </label>
            <label className="settings-field">
              <span>Cool threads target (1–20)</span>
              <input
                type="number"
                min={1}
                max={20}
                step={1}
                value={settingsDraft.targetCoolThreads}
                onChange={(e) =>
                  setSettingsDraft((prev) => ({
                    ...prev,
                    targetCoolThreads: clampTargetCoolThreads(
                      e.target.value === ""
                        ? DEFAULT_SETTINGS.targetCoolThreads
                        : Number(e.target.value),
                    ),
                  }))
                }
              />
            </label>
            <label className="settings-field">
              <span>Preferred language</span>
              <select
                className="settings-select"
                value={settingsDraft.preferredLanguage}
                onChange={(e) =>
                  setSettingsDraft((prev) => ({
                    ...prev,
                    preferredLanguage: normalizePreferredLanguage(
                      e.target.value,
                    ),
                  }))
                }
              >
                {(
                  [
                    ["en", "English"],
                    ["es", "Spanish"],
                    ["fr", "French"],
                    ["de", "German"],
                    ["pt", "Portuguese"],
                  ] as const satisfies ReadonlyArray<
                    readonly [(typeof PREFERRED_LANGUAGES)[number], string]
                  >
                ).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label} ({code})
                  </option>
                ))}
              </select>
            </label>
            <div className="settings-checks">
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settingsDraft.dropArticles}
                  onChange={(e) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      dropArticles: e.target.checked,
                    }))
                  }
                />
                <span>Drop X Articles and replies to them</span>
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settingsDraft.dropEmDashes}
                  onChange={(e) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      dropEmDashes: e.target.checked,
                    }))
                  }
                />
                <span>Drop posts with em dashes (—)</span>
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settingsDraft.dropAutomatedAccounts}
                  onChange={(e) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      dropAutomatedAccounts: e.target.checked,
                    }))
                  }
                />
                <span>Drop automated accounts</span>
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settingsDraft.dedupeAccounts}
                  onChange={(e) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      dedupeAccounts: e.target.checked,
                    }))
                  }
                />
                <span>Dedupe accounts I&apos;ve interacted with</span>
              </label>
            </div>
            <ExcludedTagsField
              tags={settingsDraft.excludedTags}
              onChange={(excludedTags) =>
                setSettingsDraft((prev) => ({ ...prev, excludedTags }))
              }
            />
            <ExcludedAccountsField
              accounts={settingsDraft.excludedAccounts}
              onChange={(excludedAccounts) =>
                setSettingsDraft((prev) => ({ ...prev, excludedAccounts }))
              }
            />
          </div>
          <div className="settings-footer">
            <p className="settings-readonly">Author cooldown: 24 hours</p>
            <div className="settings-actions">
              <button
                type="button"
                className="primary"
                onClick={() => onSaveSettings()}
              >
                Save
              </button>
              {settingsStatus ? (
                <p className="status settings-save-status">{settingsStatus}</p>
              ) : null}
            </div>
          </div>
        </section>
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
            <div className="desk-top">
              <div className="control-pane">
                <h2>Agenda</h2>
                <textarea
                  className="agenda"
                  value={agenda}
                  onChange={(e) => setAgenda(e.target.value)}
                  placeholder="What should we look for and how should we sound?"
                />
                <div className="scout-cluster">
                  <div className="scout-controls">
                    {searching ? (
                      <button
                        type="button"
                        className="primary scout-run"
                        onClick={onStopScout}
                      >
                        Land
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="primary scout-run"
                        disabled={searchBlocked || !agenda.trim()}
                        onClick={onSearch}
                      >
                        {grounded
                          ? "Grounded"
                          : searchCooldownRemaining > 0
                            ? `Hold short ${searchCooldownRemaining}s`
                            : "Take off"}
                      </button>
                    )}
                  </div>
                  <div className="status-stack" aria-live="polite">
                    <p
                      className={
                        searching
                          ? "status scout-flight-line"
                          : "status status-main"
                      }
                    >
                      {grounded && !searching
                        ? `Grounded — ${sortiesLimit ?? 0} sortie${sortiesLimit === 1 ? "" : "s"} used today. Next takeoff after 00:00 UTC.`
                        : searchCooldownRemaining > 0 && !searching
                          ? `Hold short ${searchCooldownRemaining}s.`
                          : status || "On the ground — set an agenda and take off."}
                    </p>
                    {billing?.sorties && !grounded && !searching ? (
                      <p className="status status-hint">
                        {sortiesLeft ?? 0} sortie
                        {sortiesLeft === 1 ? "" : "s"} left today
                      </p>
                    ) : null}
                  </div>
                  <div
                    className={searching ? "scout-strip active" : "scout-strip"}
                  >
                    <div
                      className={searching ? "scout-bar" : "scout-bar idle"}
                      aria-hidden="true"
                    />
                  </div>
                </div>
                <ScoutPixelField searching={searching} />
              </div>
              <div
                className={
                  flightPathOpen
                    ? "threads-activity"
                    : "threads-activity is-collapsed"
                }
                aria-label="Flight path"
              >
              <div className="threads-activity-head">
                <div className="threads-activity-copy">
                  <button
                    type="button"
                    className="threads-activity-toggle-path"
                    aria-expanded={flightPathOpen}
                    onClick={onToggleFlightPath}
                  >
                    <span className="threads-activity-title">Flight path</span>
                    <span className="threads-activity-caret" aria-hidden="true">
                      {flightPathOpen ? "–" : "+"}
                    </span>
                  </button>
                  {flightPathOpen ? (
                    <span className="threads-activity-sub">
                      Altitude is sampled views. Marks without a sample hold the
                      last altitude.
                    </span>
                  ) : null}
                </div>
                <div
                  className="threads-activity-toggle"
                  role="group"
                  aria-label="Activity bucket"
                >
                  <button
                    type="button"
                    className={
                      activityBucket === "day"
                        ? "threads-tab active"
                        : "threads-tab"
                    }
                    aria-pressed={activityBucket === "day"}
                    onClick={() => onActivityBucket("day")}
                  >
                    Day
                  </button>
                  <button
                    type="button"
                    className={
                      activityBucket === "week"
                        ? "threads-tab active"
                        : "threads-tab"
                    }
                    aria-pressed={activityBucket === "week"}
                    onClick={() => onActivityBucket("week")}
                  >
                    Week
                  </button>
                </div>
              </div>
              <div className="threads-activity-meta">
                <span className="chip">
                  {activityStats.totals.interactions} marked
                </span>
                <span className="chip">
                  {activityStats.totals.views} views
                </span>
                {activityStats.totals.withStats > 0 ? (
                  <span className="chip chip-muted">
                    {activityStats.totals.withStats} sampled
                  </span>
                ) : null}
                <span
                  className="chip"
                  title="UTC daily streak — mark ≥1 interacted each UTC day"
                >
                  Streak {gamification.currentStreak}
                  {gamification.longestStreak > gamification.currentStreak
                    ? ` · best ${gamification.longestStreak}`
                    : ""}
                </span>
                <span
                  className="chip threads-activity-level"
                  title="XP from marks (+1) and 24h engagement bonuses"
                >
                  Lv {gamification.level} · {gamification.lifetimeXp} XP
                  <span
                    className="threads-activity-xp-bar"
                    aria-hidden="true"
                  >
                    <span
                      className="threads-activity-xp-fill"
                      style={{
                        width: `${Math.min(
                          100,
                          (gamification.xpIntoLevel / gamification.xpToNext) *
                            100,
                        )}%`,
                      }}
                    />
                  </span>
                </span>
              </div>
              <div className="threads-activity-chart">
                {activityStats.totals.interactions === 0 ? (
                  <p className="threads-activity-empty">
                    Post a reply to start a flight path.
                  </p>
                ) : (
                  <ActivityChart
                    series={activityStats.series}
                    bucket={activityStats.bucket}
                    compact={!flightPathOpen}
                  />
                )}
              </div>
              </div>
            </div>
            <div className="threads-pane-head">
              <h2 className="section-label">Threads</h2>
              <div className="threads-tabs" role="tablist" aria-label="Thread feeds">
                <button
                  type="button"
                  role="tab"
                  aria-selected={threadsTab === "curated"}
                  className={
                    threadsTab === "curated"
                      ? "threads-tab active"
                      : "threads-tab"
                  }
                  onClick={() => setThreadsTab("curated")}
                >
                  For You
                  <ThreadsTabCount
                    n={curatedThreads.length + forYouSuggestions.length}
                  />
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={threadsTab === "interacted"}
                  className={
                    threadsTab === "interacted"
                      ? "threads-tab active"
                      : "threads-tab"
                  }
                  onClick={() => setThreadsTab("interacted")}
                >
                  Interacted
                  <ThreadsTabCount n={interactedHistory.length} />
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={threadsTab === "skipped"}
                  className={
                    threadsTab === "skipped"
                      ? "threads-tab active"
                      : "threads-tab"
                  }
                  onClick={() => setThreadsTab("skipped")}
                >
                  Skipped
                  <ThreadsTabCount n={skippedHistory.length} />
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={threadsTab === "dismissed"}
                  className={
                    threadsTab === "dismissed"
                      ? "threads-tab active"
                      : "threads-tab"
                  }
                  onClick={() => setThreadsTab("dismissed")}
                >
                  Not interested
                  <ThreadsTabCount n={dismissedHistory.length} />
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={threadsTab === "expired"}
                  className={
                    threadsTab === "expired"
                      ? "threads-tab active"
                      : "threads-tab"
                  }
                  onClick={() => setThreadsTab("expired")}
                >
                  Expired
                  <ThreadsTabCount n={expiredHistory.length} />
                </button>
              </div>
            </div>
            <div className="threads-scroll">
              {threadsTab === "curated" ? (
                curatedThreads.length === 0 &&
                forYouSuggestions.length === 0 ? (
                  <p className="empty">
                    {searching
                      ? "Scout is working…"
                      : "Nothing in For You yet. Take off for reply targets. Daily suggestions land here once we have enough of your 24h post stats."}
                  </p>
                ) : (
                  <div className="threads">
                    {forYouSuggestions.length > 0 ? (
                      <div className="for-you-suggested">
                        <h3 className="section-label">Suggested</h3>
                        {forYouSuggestions.map((row, i) => (
                          <SuggestedRow
                            key={row.id}
                            row={row}
                            index={i}
                            busy={actionBusy}
                            voice={voice}
                            agenda={agenda}
                            xLinked={authUser?.xLinked}
                            hasSession={Boolean(authUser)}
                            onPosted={() => void actForYou(row.id, "done")}
                            onSkip={() => void actForYou(row.id, "skip")}
                            onDismiss={() => void actForYou(row.id, "dismiss")}
                            onOpenSettings={openVoice}
                            onLinkX={startXLogin}
                            onUsage={(u) =>
                              setVoice((v) => (v ? { ...v, suggests: u } : v))
                            }
                          />
                        ))}
                      </div>
                    ) : null}
                    {sortThreadsByCreatedAtNewest(curatedThreads).map((t) => (
                      <ThreadRow
                        key={t.id}
                        thread={t}
                        open={expandedId === t.id}
                        busy={actionBusy}
                        interacted={interactedIds.has(t.id)}
                        onToggle={() => {
                          const next = expandedId === t.id ? null : t.id;
                          setExpandedId(next);
                          if (next) watchDeskThreads([t]);
                        }}
                        onWatch={() => watchDeskThreads([t])}
                        onMark={() => openMarkModal(t)}
                        onSkip={() => void onSkip(t)}
                        onDismiss={() => openDismissModal(t)}
                        suggest={
                          voice?.status === "ready" && voice.unlocked ? (
                            <SuggestPane
                              threadId={t.id}
                              author={t.author}
                              text={t.text}
                              opAuthor={t.opAuthor}
                              opText={t.opText}
                              threadKind={t.threadKind}
                              flags={t.flags}
                              agenda={agenda}
                              usage={voice.suggests}
                              onUsage={(u) =>
                                setVoice((v) =>
                                  v ? { ...v, suggests: u } : v,
                                )
                              }
                              onOpenIntent={() => watchDeskThreads([t])}
                            />
                          ) : (
                            <SuggestLocked
                              voice={voice}
                              xLinked={authUser?.xLinked}
                              hasSession={Boolean(authUser)}
                              onOpenSettings={openVoice}
                              onLinkX={startXLogin}
                            />
                          )
                        }
                      />
                    ))}
                  </div>
                )
              ) : threadsTab === "interacted" ? (
                interactedHistory.length === 0 ? (
                  <p className="empty">
                    No interacted threads yet. Open on X, then tap I posted on X after you reply.
                  </p>
                ) : (
                  <div className="history-list">
                    {interactedHistory.map((entry, i) => (
                      <InteractedRow
                        key={entry.threadId}
                        entry={entry}
                        index={i}
                      />
                    ))}
                  </div>
                )
              ) : threadsTab === "skipped" ? (
                skippedHistory.length === 0 ? (
                  <p className="empty">
                    No skipped threads yet. Skip a For You lead to pass on it
                    without dismissing the author.
                  </p>
                ) : (
                  <div className="history-list">
                    {skippedHistory.map((entry, i) => (
                      <SkippedRow
                        key={entry.threadId}
                        entry={entry}
                        index={i}
                      />
                    ))}
                  </div>
                )
              ) : threadsTab === "dismissed" ? (
                dismissedHistory.length === 0 ? (
                  <p className="empty">
                    No dismissed threads yet. Mark a For You lead as not interested
                    to dismiss it with an optional reason.
                  </p>
                ) : (
                  <div className="history-list">
                    {dismissedHistory.map((entry, i) => (
                      <DismissedRow
                        key={entry.threadId}
                        entry={entry}
                        index={i}
                      />
                    ))}
                  </div>
                )
              ) : expiredHistory.length === 0 ? (
                <p className="empty">
                  No expired threads yet. Cool leads older than 24h move here
                  automatically.
                </p>
              ) : (
                <div className="history-list">
                  {expiredHistory.map((entry, i) => (
                    <ExpiredRow
                      key={entry.threadId}
                      entry={entry}
                      index={i}
                    />
                  ))}
                </div>
              )}
            </div>
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
