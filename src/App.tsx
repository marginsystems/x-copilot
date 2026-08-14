import { useEffect, useRef, useState } from "react";
import {
  formatScoutFailure,
  isScoutGateError,
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
import { ExcludedTagsField } from "./ExcludedTagsField";
import {
  MARK_DETECT_TIMEOUT_MS,
  markDetectCheckingNote,
  markDetectMissNote,
  markDetectTimeoutNote,
  markDetectWaitingNote,
  nextMarkDetectWaitMs,
  shouldContinueMarkDetectPoll,
  waitWithCountdown,
} from "./lib/markDetectPoll";
import { formatAbsoluteTime, formatTimeAgo } from "./lib/timeAgo";
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
import { stripMediaShortlinksFromText } from "./lib/mediaText";
import { apiFetch, apiUrl, isLocalHostname } from "./lib/apiBase";
import { authErrorMessage } from "./lib/authErrors";
import { applyTheme, nextTheme, readTheme, type Theme } from "./lib/theme";
import { AuthButtons } from "./AuthButtons";
import { BootScreen, Landing } from "./Landing";
import { Onboarding } from "./Onboarding";
import { readOnboardingAgenda, readOnboardingComplete } from "./lib/onboarding";
import { BillingPanel, type BillingMe, type PaidPlanKey } from "./BillingPanel";
import { AdminPanel, type AdminTenantRow } from "./AdminPanel";

/** Hard-filter candidate bucket size sent on each Scout run. */
const SCOUT_BUCKET_SIZE = 20;

/** Closed preference category from triage (mirrors server THREAD_KINDS). */
type ThreadKind =
  | "timely_take"
  | "fact_add"
  | "sharp_opinion"
  | "lived_answer"
  | "hollow_ask"
  | "promo_context"
  | "bare_news"
  | "closed_thread"
  | "other";

type ThreadCard = {
  id: string;
  author: string;
  text: string;
  url: string;
  createdAt?: string;
  summary?: string;
  /** Parent tweet context when this card is a reply. */
  opAuthor?: string;
  opText?: string;
  isReply?: boolean;
  /** X conversation root (OP status id) when known. */
  conversationId?: string;
  /** Immediate parent status id when this card is a reply. */
  inReplyToId?: string;
  /** Native media t.co keys (lowercased); hide from card text display. */
  mediaShortlinks?: string[];
  /** 0–100, higher = more engagement bait. */
  baitScore?: number;
  flags?: string[];
  intent?: string;
  threadKind?: ThreadKind;
  engage?: "skip" | "consider" | "priority";
  reason?: string;
  score?: number;
};

type ScoutStreamEvent = {
  agent?: string;
  stage?: ScoutStageId | string;
  message?: string;
  threads?: ThreadCard[];
  queries?: string[];
  coolCount?: number;
  targetCool?: number;
  stopReason?: "qualified" | "target" | "exhausted" | "aborted" | "rate_limited" | "terminal_error" | "credits_exhausted";
  candidates?: number;
  bucketSize?: number;
  triageWarning?: string;
  cooldownWarning?: string;
  linkWarning?: string;
  linkFiltered?: number;
  emDashWarning?: string;
  emDashFiltered?: number;
  automatedWarning?: string;
  lengthWarning?: string;
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

type ScoutLogEntry = {
  at: string;
  message: string;
  stage?: string;
};

type ReplyStatSnapshot = {
  views?: number;
  likes?: number;
  replies?: number;
  retweets?: number;
  sampledAt: string;
};

type InteractionHistoryEntry = {
  threadId: string;
  author: string;
  at: string;
  url?: string;
  summary?: string;
  text?: string;
  replyId?: string;
  replyUrl?: string;
  postedAt?: string;
  conversationId?: string;
  inReplyToId?: string;
  stats?: {
    t1h?: ReplyStatSnapshot;
    t24h?: ReplyStatSnapshot;
  };
};

/** Keep in sync with server/src/interactionStore.ts parseStatusIdFromUrl. */
function parseStatusIdFromUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (
      host !== "x.com" &&
      host !== "twitter.com" &&
      host !== "mobile.twitter.com"
    ) {
      return null;
    }
    const m = u.pathname.match(/\/status(?:es)?\/(\d+)/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

type ThreadsTab =
  | "curated"
  | "interacted"
  | "skipped"
  | "dismissed"
  | "expired";

type DismissalHistoryEntry = {
  threadId: string;
  author: string;
  at: string;
  url?: string;
  summary?: string;
  text?: string;
  reason?: string;
  conversationId?: string;
  inReplyToId?: string;
};

type SkipHistoryEntry = {
  threadId: string;
  author: string;
  at: string;
  url?: string;
  summary?: string;
  text?: string;
};

type ExpiredHistoryEntry = {
  threadId: string;
  author: string;
  at: string;
  createdAt?: string;
  url?: string;
  summary?: string;
  text?: string;
};

const SCOUT_LOG_PAGE_SIZE = 100;

function normalizeAuthorKey(author: string): string {
  return author.trim().replace(/^@+/, "").toLowerCase();
}

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

function appendThreadsById(
  prev: ThreadCard[],
  next: ThreadCard[] | undefined,
): ThreadCard[] {
  if (!next?.length) return prev;
  const seen = new Set(prev.map((t) => t.id));
  const out = [...prev];
  for (const t of next) {
    if (!t.id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

function coolProgressLabel(
  coolCount: number | undefined,
  targetCool: number | undefined,
  fallbackTarget: number,
): string {
  const cool = typeof coolCount === "number" ? coolCount : 0;
  const target =
    typeof targetCool === "number" ? targetCool : fallbackTarget;
  return `Cool ${cool}/${target}`;
}

function scoutProgressPrefix(ev: {
  message?: string;
  candidates?: number;
  bucketSize?: number;
  coolCount?: number;
  targetCool?: number;
}): string | null {
  if (
    typeof ev.candidates === "number" &&
    typeof ev.bucketSize === "number" &&
    (ev.coolCount ?? 0) === 0
  ) {
    return `Cand. ${ev.candidates}/${ev.bucketSize}`;
  }
  if (typeof ev.coolCount === "number" && ev.coolCount > 0) {
    return typeof ev.targetCool === "number"
      ? `Cool ${ev.coolCount}/${ev.targetCool}`
      : `Cool ${ev.coolCount}`;
  }
  return null;
}

function ThreadRow({
  thread,
  open,
  busy,
  interacted,
  onToggle,
  onMark,
  onSkip,
  onDismiss,
}: {
  thread: ThreadCard;
  open: boolean;
  busy: boolean;
  interacted: boolean;
  onToggle: () => void;
  onMark: () => void;
  onSkip: () => void;
  onDismiss: () => void;
}) {
  const bait = baitRisk(thread);
  const ago = formatTimeAgo(thread.createdAt);
  const absolute = formatAbsoluteTime(thread.createdAt);
  const displayText = stripMediaShortlinksFromText(
    thread.text,
    thread.mediaShortlinks,
  );
  const tags = [
    ...new Set(
      [thread.threadKind, thread.intent, ...(thread.flags ?? [])].filter(
        Boolean,
      ),
    ),
  ];
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
        {bait !== null ? (
          <span
            className={baitClass(bait)}
            title="Engagement-bait risk — higher is worse"
          >
            {bait}
          </span>
        ) : (
          <span className="bait" aria-hidden="true" />
        )}
        <span className="row-main">
          <span className="row-summary">{thread.summary ?? displayText}</span>
          <span className="row-meta">
            <span>{thread.author}</span>
            {ago ? <span title={absolute ?? undefined}>{ago}</span> : null}
            {interacted ? (
              <span className="chip chip-interacted">interacted</span>
            ) : null}
            {bait !== null &&
            (thread.engage === "skip" || thread.engage === "priority") ? (
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
          <p className="original">{displayText}</p>
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
            <button
              className="primary"
              disabled={busy || interacted}
              onClick={onMark}
            >
              {interacted ? "Interacted" : "Mark interacted"}
            </button>
            <button
              className="ghost"
              disabled={busy || interacted}
              onClick={onSkip}
            >
              Skip
            </button>
            <button
              className="ghost"
              disabled={busy || interacted}
              onClick={onDismiss}
            >
              Not interested
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function SkippedRow({ entry }: { entry: SkipHistoryEntry }) {
  const ago = formatTimeAgo(entry.at);
  const absolute = formatAbsoluteTime(entry.at);
  const blurb = entry.summary || entry.text || entry.threadId;
  return (
    <article className="thread-row interacted-row">
      <div className="row-head static">
        <span className="bait" aria-hidden="true" />
        <span className="row-main">
          <span className="row-summary">{blurb}</span>
          <span className="row-meta">
            <span>{entry.author}</span>
            {ago ? <span title={absolute ?? undefined}>{ago}</span> : null}
            <span className="chip">skipped</span>
          </span>
        </span>
      </div>
    </article>
  );
}

function DismissedRow({ entry }: { entry: DismissalHistoryEntry }) {
  const ago = formatTimeAgo(entry.at);
  const absolute = formatAbsoluteTime(entry.at);
  const blurb = entry.summary || entry.text || entry.threadId;
  return (
    <article className="thread-row interacted-row">
      <div className="row-head static">
        <span className="bait" aria-hidden="true" />
        <span className="row-main">
          <span className="row-summary">{blurb}</span>
          <span className="row-meta">
            <span>{entry.author}</span>
            {ago ? <span title={absolute ?? undefined}>{ago}</span> : null}
            <span className="chip">not interested</span>
          </span>
          {entry.reason ? (
            <span className="row-meta">{entry.reason}</span>
          ) : null}
        </span>
      </div>
      {entry.url ? (
        <div className="row-detail compact">
          <div className="row">
            <a className="ghost" href={entry.url} target="_blank" rel="noreferrer">
              Open on X
            </a>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ExpiredRow({ entry }: { entry: ExpiredHistoryEntry }) {
  const tweetAgo = formatTimeAgo(entry.createdAt);
  const expiredAgo = formatTimeAgo(entry.at);
  const absolute = formatAbsoluteTime(entry.createdAt || entry.at);
  const blurb = entry.summary || entry.text || entry.threadId;
  return (
    <article className="thread-row interacted-row">
      <div className="row-head static">
        <span className="bait" aria-hidden="true" />
        <span className="row-main">
          <span className="row-summary">{blurb}</span>
          <span className="row-meta">
            <span>{entry.author}</span>
            {tweetAgo ? (
              <span title={absolute ?? undefined}>{tweetAgo}</span>
            ) : null}
            <span className="chip">expired</span>
            {expiredAgo ? <span>moved {expiredAgo}</span> : null}
          </span>
        </span>
      </div>
      {entry.url ? (
        <div className="row-detail compact">
          <div className="row">
            <a className="ghost" href={entry.url} target="_blank" rel="noreferrer">
              Open on X
            </a>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function formatStatChip(
  label: string,
  snap: ReplyStatSnapshot | undefined,
  pending: boolean,
): string {
  if (snap) {
    const views =
      typeof snap.views === "number" ? snap.views.toLocaleString() : "—";
    const likes =
      typeof snap.likes === "number" ? snap.likes.toLocaleString() : "—";
    return `${label}: ${views} views · ${likes} likes`;
  }
  if (pending) return `${label}: pending`;
  return "";
}

function InteractedRow({
  entry,
}: {
  entry: InteractionHistoryEntry;
}) {
  const ago = formatTimeAgo(entry.at);
  const absolute = formatAbsoluteTime(entry.at);
  const blurb = entry.summary || entry.text || entry.threadId;
  const hasReply = Boolean(entry.replyId);
  const t1hLabel = formatStatChip("1h", entry.stats?.t1h, hasReply);
  const t24hLabel = formatStatChip("24h", entry.stats?.t24h, hasReply);
  const replyHref = entry.replyUrl;
  return (
    <article className="thread-row interacted-row">
      <div className="row-head static">
        <span className="bait" aria-hidden="true" />
        <span className="row-main">
          <span className="row-summary">{blurb}</span>
          <span className="row-meta">
            <span>{entry.author}</span>
            {ago ? <span title={absolute ?? undefined}>{ago}</span> : null}
            <span className="chip chip-interacted">interacted</span>
            {t1hLabel ? <span className="chip">{t1hLabel}</span> : null}
            {t24hLabel ? <span className="chip">{t24hLabel}</span> : null}
          </span>
        </span>
      </div>
      {entry.url || replyHref ? (
        <div className="row-detail compact">
          <div className="row">
            {entry.url ? (
              <a className="ghost" href={entry.url} target="_blank" rel="noreferrer">
                Open on X
              </a>
            ) : null}
            {replyHref ? (
              <a className="ghost" href={replyHref} target="_blank" rel="noreferrer">
                Open reply
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

type AppView = "dashboard" | "settings" | "usage" | "admin";
type DeskTab = "agent" | "threads";

type UsageWindow = "24h" | "7d" | "all";

type UsageRecentRow = {
  id: string;
  at: string;
  activity: string;
  status: number;
  error: string | null;
  credits: number;
  remaining: number | null;
};

type UsageSummaryResponse = {
  ok: boolean;
  tenantSlug?: string;
  window?: UsageWindow;
  calls?: number;
  creditsUsed?: number;
  creditLimit?: number;
  remaining?: number;
  creditsDepletedRecent?: boolean;
  note?: string;
  recent?: UsageRecentRow[];
  error?: string;
  message?: string;
};

type AuthSessionUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  onboardingCompleted: boolean;
  agenda: string | null;
  xUsername: string | null;
  isAdmin: boolean;
};

function viewFromPath(pathname: string): AppView {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if (pathname === "/usage" || pathname === "/billing") return "usage";
  if (pathname === "/settings") return "settings";
  return "dashboard";
}

function pathFromView(view: AppView): string {
  if (view === "admin") return "/admin";
  if (view === "usage") return "/usage";
  if (view === "settings") return "/settings";
  return "/";
}

/** Matches server SCOUT_COOLDOWN_MS — one Search every 15s after a run ends. */
const SEARCH_COOLDOWN_MS = 15_000;

export default function App() {
  const [agenda, setAgenda] = useState(
    "Find builders sharing opinions, tradeoffs, or concrete takes on shipping AI / software tools in public. Prefer posts with a clear point of view or a specific technical claim I can agree/disagree with.\nSkip open-ended engagement questions (“what are you shipping?”, “drop your stack”, “who should I follow?”, generic peer polls) even when they mention AI/build-in-public. A lone question with little substance is not interesting.",
  );
  const [status, setStatus] = useState(
    "Idle — verify session, then let Scout search from your agenda",
  );
  const [plannedQueries, setPlannedQueries] = useState<string[]>([]);
  const [threads, setThreads] = useState<ThreadCard[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Short mutex for mark/skip/dismiss/session/settings — not Scout-in-flight. */
  const [actionBusy, setActionBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [scoutOptionsOpen, setScoutOptionsOpen] = useState(false);
  const [scoutStage, setScoutStage] = useState<ScoutStageId | null>(null);
  const [scoutLog, setScoutLog] = useState<ScoutLogEntry[]>([]);
  const [scoutLogPage, setScoutLogPage] = useState(0);
  const [interactedIds, setInteractedIds] = useState<Set<string>>(() => new Set());
  const [interactedHistory, setInteractedHistory] = useState<
    InteractionHistoryEntry[]
  >([]);
  const [dismissedHistory, setDismissedHistory] = useState<
    DismissalHistoryEntry[]
  >([]);
  const [skippedHistory, setSkippedHistory] = useState<SkipHistoryEntry[]>([]);
  const [expiredHistory, setExpiredHistory] = useState<ExpiredHistoryEntry[]>(
    [],
  );
  const [threadsTab, setThreadsTab] = useState<ThreadsTab>("curated");
  const [activityBucket, setActivityBucket] = useState<ActivityBucket>("day");
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
    typeof window === "undefined" ? "dashboard" : viewFromPath(window.location.pathname),
  );
  const [deskTab, setDeskTab] = useState<DeskTab>("threads");
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
  const [menuEntered, setMenuEntered] = useState(false);
  const [sessionUser, setSessionUser] = useState<{
    screen_name: string;
    name: string;
  } | null>(null);
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
  const manualVerifyDoneRef = useRef(false);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(() =>
    loadSettings(),
  );
  const [settingsStatus, setSettingsStatus] = useState("");
  const [searchCooldownUntil, setSearchCooldownUntil] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [markThread, setMarkThread] = useState<ThreadCard | null>(null);
  const [markReplyUrl, setMarkReplyUrl] = useState("");
  const [markReply, setMarkReply] = useState("");
  const [markDetecting, setMarkDetecting] = useState(false);
  const [markDetectNote, setMarkDetectNote] = useState("");
  const [markDetectMissed, setMarkDetectMissed] = useState(false);
  const [dismissThread, setDismissThread] = useState<ThreadCard | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const markDetectGenRef = useRef(0);
  const markDetectAbortRef = useRef<AbortController | null>(null);
  const dismissedIdsRef = useRef<Set<string>>(new Set());
  const skippedIdsRef = useRef<Set<string>>(new Set());
  const expiredIdsRef = useRef<Set<string>>(new Set());
  const interactedIdsRef = useRef<Set<string>>(new Set());
  const blockedConversationsRef = useRef<Set<string>>(new Set());
  const searchingRef = useRef(0);
  const coolProgressRef = useRef({
    cool: 0,
    target: DEFAULT_SETTINGS.targetCoolThreads,
  });
  const staleHydration = useRef(false);
  const menuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchCooldownRemaining = Math.max(
    0,
    Math.ceil((searchCooldownUntil - nowMs) / 1000),
  );
  const searchBlocked = searching || searchCooldownRemaining > 0;

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
    }, 160);
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
    setScoutLogPage(0);
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
    if (typeof ev.coolCount === "number") {
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
    setScoutStage(stage);
    setStatus(message);
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
      setScoutLogPage(0);
    } catch {
      /* ignore */
    }
  }

  function onStopScout() {
    abortRef.current?.abort();
  }

  function updateTargetCoolThreads(value: number) {
    const targetCoolThreads = clampTargetCoolThreads(value);
    setSettings((prev) => ({ ...prev, targetCoolThreads }));
    saveSettings({ ...settings, targetCoolThreads });
    setSettingsDraft((prev) => ({ ...prev, targetCoolThreads }));
  }

  async function hydrateInteracted() {
    try {
      const res = await apiFetch("/api/interacted");
      if (!res.ok) return;
      const data = (await res.json()) as {
        interactions?: InteractionHistoryEntry[];
        activeIds?: string[];
      };
      const history = (data.interactions ?? []).filter(
        (i) =>
          i &&
          typeof i.threadId === "string" &&
          typeof i.author === "string" &&
          typeof i.at === "string",
      );
      setInteractedHistory(history);
      const ids = new Set(
        (Array.isArray(data.activeIds) ? data.activeIds : []).filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      );
      interactedIdsRef.current = ids;
      setInteractedIds(ids);
      const blocked = new Set(blockedConversationsRef.current);
      for (const i of history) {
        const root =
          i.conversationId?.trim() ||
          i.inReplyToId?.trim() ||
          i.threadId.trim();
        if (root) blocked.add(root);
        if (i.threadId.trim()) blocked.add(i.threadId.trim());
        if (i.inReplyToId?.trim()) blocked.add(i.inReplyToId.trim());
      }
      blockedConversationsRef.current = blocked;
      if (ids.size || blocked.size) {
        setThreads((prev) => prev.filter((t) => keepInCurated(t)));
      }
    } catch {
      // Sidecar may be offline on first paint — ignore.
    }
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

  function isHiddenFromCurated(id: string): boolean {
    return (
      dismissedIdsRef.current.has(id) ||
      skippedIdsRef.current.has(id) ||
      expiredIdsRef.current.has(id) ||
      interactedIdsRef.current.has(id)
    );
  }

  function keepInCurated(
    thread: ThreadCard,
    excludedTags: readonly string[] = settings.excludedTags,
  ): boolean {
    const blocked = blockedConversationsRef.current;
    return (
      !isHiddenFromCurated(thread.id) &&
      !blocked.has(thread.id) &&
      !(thread.conversationId && blocked.has(thread.conversationId)) &&
      !(thread.inReplyToId && blocked.has(thread.inReplyToId)) &&
      !threadHasExcludedTag(thread, excludedTags)
    );
  }

  const curatedThreads = threads.filter((t) => keepInCurated(t));

  async function hydrateSkipped() {
    try {
      const res = await apiFetch("/api/skipped");
      if (!res.ok) return;
      const data = (await res.json()) as {
        skipped?: SkipHistoryEntry[];
        skippedIds?: string[];
      };
      const history = (data.skipped ?? []).filter(
        (d) =>
          d &&
          typeof d.threadId === "string" &&
          typeof d.author === "string" &&
          typeof d.at === "string",
      );
      setSkippedHistory(history);
      const ids = new Set(
        (Array.isArray(data.skippedIds)
          ? data.skippedIds
          : history.map((d) => d.threadId)
        ).filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      );
      skippedIdsRef.current = ids;
      if (ids.size) {
        setThreads((prev) => prev.filter((t) => !isHiddenFromCurated(t.id)));
      }
    } catch {
      // Sidecar may be offline on first paint — ignore.
    }
  }

  async function hydrateDismissed() {
    try {
      const res = await apiFetch("/api/dismissed");
      if (!res.ok) return;
      const data = (await res.json()) as {
        dismissals?: DismissalHistoryEntry[];
        dismissedIds?: string[];
      };
      const history = (data.dismissals ?? []).filter(
        (d) =>
          d &&
          typeof d.threadId === "string" &&
          typeof d.author === "string" &&
          typeof d.at === "string",
      );
      setDismissedHistory(history);
      const ids = new Set(
        (Array.isArray(data.dismissedIds) ? data.dismissedIds : history.map((d) => d.threadId)).filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      );
      dismissedIdsRef.current = ids;
      const blocked = new Set(blockedConversationsRef.current);
      for (const d of history) {
        const root =
          d.conversationId?.trim() ||
          d.inReplyToId?.trim() ||
          d.threadId.trim();
        if (root) blocked.add(root);
        if (d.threadId.trim()) blocked.add(d.threadId.trim());
        if (d.inReplyToId?.trim()) blocked.add(d.inReplyToId.trim());
      }
      blockedConversationsRef.current = blocked;
      if (ids.size || blocked.size) {
        setThreads((prev) => prev.filter((t) => keepInCurated(t)));
      }
    } catch {
      // Sidecar may be offline on first paint — ignore.
    }
  }

  async function hydrateExpired() {
    try {
      const res = await apiFetch("/api/expired");
      if (!res.ok) return;
      const data = (await res.json()) as {
        expired?: ExpiredHistoryEntry[];
        expiredIds?: string[];
      };
      const history = (data.expired ?? []).filter(
        (e) =>
          e &&
          typeof e.threadId === "string" &&
          typeof e.author === "string" &&
          typeof e.at === "string",
      );
      setExpiredHistory(history);
      const ids = new Set(
        (Array.isArray(data.expiredIds)
          ? data.expiredIds
          : history.map((e) => e.threadId)
        ).filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      );
      expiredIdsRef.current = ids;
      if (ids.size) {
        setThreads((prev) => prev.filter((t) => !isHiddenFromCurated(t.id)));
      }
    } catch {
      // Sidecar may be offline on first paint — ignore.
    }
  }

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
      const queries = Array.isArray(data.snapshot.queries)
        ? data.snapshot.queries
        : [];
      if (typeof data.snapshot.agenda === "string" && data.snapshot.agenda.trim()) {
        setAgenda(data.snapshot.agenda);
      }
      const filtered = list.filter((t) => keepInCurated(t));
      setThreads(filtered);
      setPlannedQueries(queries);
      setScoutStage(null);
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
        `Restored ${filtered.length} threads${funnel} from ${when} — Search again to refresh.`,
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

  async function hydrateSession() {
    try {
      const res = await apiFetch("/api/session/verify");
      if (manualVerifyDoneRef.current) return;
      const data = (await res.json()) as {
        ok?: boolean;
        user?: { screen_name: string; name: string };
      };
      if (
        !res.ok ||
        !data.ok ||
        !data.user?.screen_name ||
        data.user.screen_name === "unknown"
      ) {
        setSessionUser(null);
        return;
      }
      setSessionUser({
        screen_name: data.user.screen_name,
        name: data.user.name ?? data.user.screen_name,
      });
    } catch {
      // Sidecar may be offline on first paint — leave unverified.
      if (manualVerifyDoneRef.current) return;
      setSessionUser(null);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = authErrorMessage(params.get("auth_error"));
    if (err) setAuthNotice(err);
    else if (params.get("auth") === "ok") setAuthNotice("Signed in.");
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
    void hydrateSession();
    void (async () => {
      const user = await hydrateAuth();
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
      if (onboarded) await hydrateLastScout();
      await hydrateScoutLog();
      if (checkout === "success" && sessionId) {
        await confirmCheckout(sessionId);
      }
      if (viewFromPath(window.location.pathname) === "usage" || checkout) {
        void loadUsage();
        void loadBilling();
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

  async function runMarkDetect(thread: ThreadCard, gen: number) {
    markDetectAbortRef.current?.abort();
    const ac = new AbortController();
    markDetectAbortRef.current = ac;
    setMarkDetecting(true);
    setMarkDetectMissed(false);
    const startedAt = Date.now();
    let attempt = 0;
    let lastReason: string | undefined;

    try {
      while (markDetectGenRef.current === gen && !ac.signal.aborted) {
        if (Date.now() - startedAt >= MARK_DETECT_TIMEOUT_MS) {
          setMarkDetectMissed(true);
          setMarkDetectNote(markDetectTimeoutNote());
          return;
        }
        attempt += 1;
        setMarkDetectNote(markDetectCheckingNote(attempt));

        let found = false;
        let replyUrl = "";
        let replyText = "";
        let reason: string | undefined;

        try {
          const res = await apiFetch("/api/interacted/detect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              threadId: thread.id,
              conversationId: thread.conversationId,
              once: true,
            }),
            signal: ac.signal,
          });
          if (markDetectGenRef.current !== gen) return;
          const data = (await res.json().catch(() => ({}))) as {
            found?: boolean;
            reason?: string;
            reply?: { replyUrl?: string; replyText?: string };
            message?: string;
            error?: string;
          };
          if (markDetectGenRef.current !== gen) return;

          if (!res.ok) {
            // Identity / auth failures won't recover by polling.
            if (res.status === 401 || res.status === 503) {
              setMarkDetectMissed(true);
              setMarkDetectNote(
                "Detection unavailable — session identity unresolved. Paste the URL manually.",
              );
              return;
            }
            if (res.status === 402 || data.error === "credits_exhausted") {
              setMarkDetectMissed(true);
              setMarkDetectNote(
                typeof data.message === "string" && data.message
                  ? data.message
                  : "This month's credits are used. Upgrade on Usage & Billing, or wait until the next UTC month.",
              );
              return;
            }
            reason = "search_failed";
            lastReason = reason;
          } else if (
            data.found &&
            typeof data.reply?.replyUrl === "string" &&
            parseStatusIdFromUrl(data.reply.replyUrl)
          ) {
            found = true;
            replyUrl = data.reply.replyUrl;
            replyText =
              typeof data.reply.replyText === "string"
                ? data.reply.replyText
                : "";
          } else {
            reason =
              typeof data.reason === "string" ? data.reason : "none";
            lastReason = reason;
          }
        } catch (err) {
          if (markDetectGenRef.current !== gen) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          reason = "search_failed";
          lastReason = reason;
        }

        if (found) {
          setMarkReplyUrl(replyUrl);
          setMarkReply(replyText);
          setMarkDetectMissed(false);
          setMarkDetectNote(
            "Found your reply — confirm or edit before saving.",
          );
          return;
        }

        const elapsedMs = Date.now() - startedAt;
        if (
          !shouldContinueMarkDetectPoll({
            found: false,
            reason,
            elapsedMs,
          })
        ) {
          setMarkDetectMissed(true);
          if (
            elapsedMs >= MARK_DETECT_TIMEOUT_MS &&
            reason !== "ambiguous"
          ) {
            setMarkDetectNote(markDetectTimeoutNote());
          } else {
            setMarkDetectNote(markDetectMissNote(reason ?? lastReason));
          }
          return;
        }

        const waitMs = nextMarkDetectWaitMs({ elapsedMs });
        if (waitMs <= 0) {
          setMarkDetectMissed(true);
          setMarkDetectNote(markDetectTimeoutNote());
          return;
        }

        const waited = await waitWithCountdown(waitMs, {
          signal: ac.signal,
          onTick: (secondsLeft) => {
            if (markDetectGenRef.current !== gen) return;
            setMarkDetectNote(
              markDetectWaitingNote(secondsLeft, attempt + 1),
            );
          },
        });
        if (waited === "aborted" || markDetectGenRef.current !== gen) return;
      }
    } finally {
      if (markDetectGenRef.current === gen) {
        setMarkDetecting(false);
      }
    }
  }

  function openMarkModal(thread: ThreadCard) {
    const gen = ++markDetectGenRef.current;
    setMarkThread(thread);
    setMarkReplyUrl("");
    setMarkReply("");
    void runMarkDetect(thread, gen);
  }

  function retryMarkDetect() {
    const thread = markThread;
    if (!thread || markDetecting) return;
    const gen = ++markDetectGenRef.current;
    void runMarkDetect(thread, gen);
  }

  function closeMarkModal() {
    markDetectGenRef.current += 1;
    markDetectAbortRef.current?.abort();
    markDetectAbortRef.current = null;
    setMarkThread(null);
    setMarkReplyUrl("");
    setMarkReply("");
    setMarkDetecting(false);
    setMarkDetectNote("");
    setMarkDetectMissed(false);
  }

  async function postInteracted(
    thread: ThreadCard,
    replyUrl: string,
    reply: string,
  ): Promise<boolean> {
    const urlTrimmed = replyUrl.trim();
    const replyId = parseStatusIdFromUrl(urlTrimmed);
    if (!replyId) {
      setStatus("Reply URL is required — paste the link to your reply on X.");
      return false;
    }
    const trimmed = reply.trim();
    try {
      const res = await apiFetch("/api/interacted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          author: thread.author,
          source: "manual",
          replyUrl: urlTrimmed,
          ...(trimmed ? { reply: trimmed } : {}),
          agenda,
          url: thread.url,
          text: thread.text,
          summary: thread.summary,
          opAuthor: thread.opAuthor,
          opText: thread.opText,
          conversationId: thread.conversationId,
          inReplyToId: thread.inReplyToId,
          baitScore: thread.baitScore ?? thread.score,
          engage: thread.engage,
          flags: thread.flags,
          intent: thread.intent,
          reason: thread.reason,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        interaction?: InteractionHistoryEntry;
      };
      if (!res.ok) {
        setStatus(`Mark fail: ${data.message || res.status}`);
        return false;
      }
      const key = normalizeAuthorKey(thread.author);
      const conversationRoot =
        thread.conversationId?.trim() ||
        thread.inReplyToId?.trim() ||
        thread.id;
      interactedIdsRef.current = new Set(interactedIdsRef.current).add(thread.id);
      setInteractedIds((prev) => new Set(prev).add(thread.id));
      blockedConversationsRef.current = new Set(blockedConversationsRef.current).add(conversationRoot);
      const historyEntry: InteractionHistoryEntry = data.interaction ?? {
        threadId: thread.id,
        author: thread.author,
        at: new Date().toISOString(),
        url: thread.url,
        summary: thread.summary,
        text: thread.text,
        replyId,
        replyUrl: urlTrimmed,
        postedAt: new Date().toISOString(),
        conversationId: thread.conversationId?.trim(),
        inReplyToId: thread.inReplyToId?.trim(),
      };
      setInteractedHistory((prev) => [
        historyEntry,
        ...prev.filter((i) => i.threadId !== thread.id),
      ]);
      // Drop this author and the whole conversation (OP + sibling replies).
      setThreads((prev) =>
        prev.filter((t) => {
          if (normalizeAuthorKey(t.author) === key) return false;
          if (t.id === conversationRoot) return false;
          if (t.conversationId && t.conversationId === conversationRoot) {
            return false;
          }
          if (t.inReplyToId && t.inReplyToId === conversationRoot) return false;
          return true;
        }),
      );
      setExpandedId((id) => (id === thread.id ? null : id));
      void hydrateActivityStats();
      void hydrateGamification();
      return true;
    } catch {
      setStatus("Sidecar offline — could not mark interacted");
      return false;
    }
  }

  async function onVerifySession() {
    setActionBusy(true);
    setStatus("Verifying X session…");
    try {
      const res = await apiFetch("/api/session/verify");
      const data = (await res.json()) as {
        ok?: boolean;
        user?: { screen_name: string; name: string };
        message?: string;
        error?: string;
        warning?: string;
      };
      if (
        !res.ok ||
        !data.ok ||
        !data.user?.screen_name ||
        data.user.screen_name === "unknown"
      ) {
        setSessionUser(null);
        setStatus(data.warning || `Session fail: ${data.message || data.error || res.status}`);
        return;
      }
      setSessionUser({
        screen_name: data.user.screen_name,
        name: data.user.name ?? data.user.screen_name,
      });
      setStatus(
        `Session OK — @${data.user.screen_name} (${data.user.name ?? data.user.screen_name})`,
      );
      closeMenu();
    } catch {
      setSessionUser(null);
      setStatus("Sidecar offline — run ./pm2-manager.sh restart or npm run dev:server");
    } finally {
      manualVerifyDoneRef.current = true;
      setActionBusy(false);
    }
  }

  function openSettings() {
    setSettingsDraft(settings);
    setSettingsStatus("");
    goToView("settings");
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

  function finishOnboarding(agenda: string, xUsername?: string | null) {
    setAgenda(agenda);
    setOnboardingDoneLocal(true);
    setAuthUser((prev) =>
      prev
        ? {
            ...prev,
            onboardingCompleted: true,
            agenda,
            xUsername: xUsername ?? prev.xUsername,
          }
        : prev,
    );
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

  function openAdmin() {
    goToView("admin");
    closeMenu();
    void loadAdmin();
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

  function onSaveSettings() {
    const next = saveSettings(settingsDraft);
    setSettings(next);
    setSettingsDraft(next);
    setThreads((prev) =>
      prev.filter((t) => !threadHasExcludedTag(t, next.excludedTags)),
    );
    setSettingsStatus("Saved — filters apply to Curated now and the next Scout.");
  }

  async function onSearch() {
    if (Date.now() < searchingRef.current) {
      if (isFinite(searchingRef.current)) {
        const waitSec = Math.ceil((searchingRef.current - Date.now()) / 1000);
        const line = formatScoutFailure(
          `Wait ${waitSec}s before starting Scout again.`,
          { soft: true },
        );
        setScoutStage("error");
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

    setSearching(true);
    setPlannedQueries([]);
    // Keep existing thread rows; partials + done append by id across runs.
    setExpandedId(null);
    pushScoutLine("── Start Scout ──", "planning");
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
          },
        }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const fallback = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        const detail =
          fallback.message ||
          fallback.error ||
          (!res.body ? "empty response body" : `HTTP ${res.status}`);
        const soft = isScoutGateError(res.status, fallback);
        const line = formatScoutFailure(detail, { soft });
        setScoutStage("error");
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
          if (ev.queries) {
            setPlannedQueries(ev.queries);
          }
          return;
        }
        if (ev.stage === "error") {
          applyScoutEvent(ev);
          stream.sawError = true;
          return;
        }
        applyScoutEvent(ev);
        if (ev.stage === "partial" && ev.threads?.length) {
          setThreads((prev) =>
            appendThreadsById(
              prev,
              (ev.threads ?? []).filter((t) => keepInCurated(t)),
            ),
          );
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
        setPlannedQueries(qs);
        // Append this run’s cool threads; do not wipe prior Scout loops.
        setThreads((prev) =>
          appendThreadsById(
            prev,
            list.filter((t) => keepInCurated(t)),
          ),
        );
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
          (doneEvent.lengthWarning ? ` · ${doneEvent.lengthWarning}` : "");
        setScoutStage("done");
        setStatus(summary);
        pushScoutLine(summary);
      } else if (!stream.sawError) {
        const line = formatScoutFailure("stream ended without results");
        setScoutStage("error");
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
              if (Array.isArray(data.snapshot.queries)) {
                setPlannedQueries(data.snapshot.queries);
              }
            }
          }
        } catch {
          /* sidecar may be offline — keep in-memory cools */
        }
        // Still cool down in finally so Stop / unmount cannot bypass the gate.
        const { cool, target } = coolProgressRef.current;
        const summary = `Cool ${cool}/${target} · stop: aborted`;
        setScoutStage("done");
        setStatus(summary);
        pushScoutLine(summary);
      } else {
        const line = formatScoutFailure(
          "Sidecar offline — run ./pm2-manager.sh restart or npm run dev:server",
        );
        setScoutStage("error");
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
        setStatus((prev) => {
          if (/^Wait \d+s before (starting Scout|searching) again/.test(prev)) {
            return prev;
          }
          if (
            prev.startsWith("Scout failed:") ||
            prev.startsWith("Sidecar offline") ||
            /^A Scout run is already in progress/.test(prev)
          ) {
            return `${prev} · Wait ${Math.ceil(SEARCH_COOLDOWN_MS / 1000)}s before starting Scout again.`;
          }
          return prev;
        });
      }
    }
  }

  function onMark(thread: ThreadCard) {
    openMarkModal(thread);
  }

  function openDismissModal(thread: ThreadCard) {
    setDismissThread(thread);
    setDismissReason("");
  }

  function closeDismissModal() {
    setDismissThread(null);
    setDismissReason("");
  }

  async function onSkip(thread: ThreadCard) {
    setActionBusy(true);
    try {
      const res = await apiFetch("/api/skipped", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          author: thread.author,
          url: thread.url,
          text: thread.text,
          summary: thread.summary,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        skip?: SkipHistoryEntry;
      };
      if (!res.ok) {
        setStatus(`Skip fail: ${data.message || res.status}`);
        return;
      }
      const entry: SkipHistoryEntry = data.skip ?? {
        threadId: thread.id,
        author: thread.author,
        at: new Date().toISOString(),
        url: thread.url,
        summary: thread.summary,
        text: thread.text,
      };
      skippedIdsRef.current = new Set(skippedIdsRef.current).add(thread.id);
      setSkippedHistory((prev) => [
        entry,
        ...prev.filter((d) => d.threadId !== thread.id),
      ]);
      setThreads((prev) => prev.filter((t) => t.id !== thread.id));
      setExpandedId((id) => (id === thread.id ? null : id));
      setStatus(`Skipped ${thread.author}`);
    } catch {
      setStatus("Sidecar offline — could not skip");
    } finally {
      setActionBusy(false);
    }
  }

  async function postDismissed(
    thread: ThreadCard,
    reason: string,
  ): Promise<boolean> {
    try {
      const res = await apiFetch("/api/dismissed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          author: thread.author,
          url: thread.url,
          text: thread.text,
          summary: thread.summary,
          opAuthor: thread.opAuthor,
          opText: thread.opText,
          conversationId: thread.conversationId,
          inReplyToId: thread.inReplyToId,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        dismissal?: DismissalHistoryEntry;
      };
      if (!res.ok) {
        setStatus(`Dismiss fail: ${data.message || res.status}`);
        return false;
      }
      const conversationRoot =
        thread.conversationId?.trim() ||
        thread.inReplyToId?.trim() ||
        thread.id;
      const entry: DismissalHistoryEntry = data.dismissal ?? {
        threadId: thread.id,
        author: thread.author,
        at: new Date().toISOString(),
        url: thread.url,
        summary: thread.summary,
        text: thread.text,
        conversationId: thread.conversationId?.trim(),
        inReplyToId: thread.inReplyToId?.trim(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      };
      dismissedIdsRef.current = new Set(dismissedIdsRef.current).add(thread.id);
      const blocked = new Set(blockedConversationsRef.current);
      blocked.add(conversationRoot);
      if (thread.id.trim()) blocked.add(thread.id.trim());
      if (thread.inReplyToId?.trim()) blocked.add(thread.inReplyToId.trim());
      blockedConversationsRef.current = blocked;
      setDismissedHistory((prev) => [
        entry,
        ...prev.filter((d) => d.threadId !== thread.id),
      ]);
      // Drop the card and sibling replies under the same conversation root.
      setThreads((prev) =>
        prev.filter((t) => {
          if (t.id === thread.id || t.id === conversationRoot) return false;
          if (t.conversationId && t.conversationId === conversationRoot) {
            return false;
          }
          if (t.inReplyToId && t.inReplyToId === conversationRoot) return false;
          return true;
        }),
      );
      setExpandedId((id) => (id === thread.id ? null : id));
      return true;
    } catch {
      setStatus("Sidecar offline — could not dismiss");
      return false;
    }
  }

  async function confirmDismiss() {
    const thread = dismissThread;
    if (!thread) return;
    setActionBusy(true);
    try {
      const ok = await postDismissed(thread, dismissReason);
      if (ok) {
        closeDismissModal();
        setStatus(`Marked ${thread.author} not interested`);
      }
    } finally {
      setActionBusy(false);
    }
  }

  async function confirmMarkInteracted() {
    const thread = markThread;
    if (!thread) return;
    if (!parseStatusIdFromUrl(markReplyUrl)) {
      setStatus("Reply URL is required — paste the link to your reply on X.");
      return;
    }
    setActionBusy(true);
    try {
      const ok = await postInteracted(thread, markReplyUrl, markReply);
      if (ok) {
        closeMarkModal();
        setStatus(
          markReply.trim()
            ? `Marked ${thread.author} interacted — memory saved · 24h cooldown`
            : `Marked ${thread.author} interacted — 24h cooldown`,
        );
      }
    } finally {
      setActionBusy(false);
    }
  }

  useEffect(() => {
    if (!markThread && !dismissThread) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || actionBusy) return;
      if (markThread) closeMarkModal();
      if (dismissThread) closeDismissModal();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markThread, dismissThread, actionBusy]);

  const needsLogin = authChecked && authRequired && !authUser && !localUi;
  const needsOnboarding =
    !needsLogin &&
    !onboardingDoneLocal &&
    (authUser
      ? authUser.onboardingCompleted === false &&
        !readOnboardingComplete(authUser.id)
      : !readOnboardingComplete());
  const booting = !localUi && !authChecked;

  if (booting) {
    return (
      <div className="app app-gate">
        <BootScreen />
      </div>
    );
  }

  return (
    <div className={needsLogin || needsOnboarding ? "app app-gate" : "app"}>
      <header className={needsLogin || needsOnboarding ? "brand brand-gate" : "brand"}>
        <div className="brand-bar">
          <div className="brand-lockup">
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
          </div>
          <button
            type="button"
            className={
              menuOpen && menuEntered ? "menu-toggle is-open" : "menu-toggle"
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
              <svg
                className="menu-toggle-icon"
                viewBox="0 0 24 24"
                width="20"
                height="20"
                aria-hidden="true"
              >
                <path
                  d="M5 7h14M5 12h14M5 17h14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="square"
                />
              </svg>
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
            <div className="menu-sheet-head">
              {authUser ? (
                <>
                  <p className="menu-session">
                    {authUser.displayName || authUser.email || "Signed in"}
                  </p>
                  {authUser.email ? (
                    <p className="menu-session-name">{authUser.email}</p>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="menu-session">Not signed in</p>
                  {needsLogin ? null : (
                    <p className="menu-session-hint">
                      Google allowlist on the API. X is identity-only (link after Google, or a handle whitelist).
                    </p>
                  )}
                </>
              )}
              {needsLogin || needsOnboarding ? null : (
                <p className="menu-session-hint">
                  {authUser?.xUsername
                    ? `X @${authUser.xUsername}`
                    : sessionUser
                      ? `Scout operator @${sessionUser.screen_name}`
                      : "X API not verified"}
                </p>
              )}
            </div>
            <div className="menu-actions">
              {authUser ? (
                <button
                  type="button"
                  className="ghost menu-action"
                  onClick={() => void onLogout()}
                >
                  Sign out
                </button>
              ) : needsLogin ? null : (
                <AuthButtons
                  stacked
                  onGoogle={startGoogleLogin}
                  onX={startXLogin}
                />
              )}
              <button
                type="button"
                className="ghost menu-action"
                onClick={() => setTheme((t) => nextTheme(t))}
              >
                {theme === "dark" ? "Light theme" : "Dark theme"}
              </button>
              {needsLogin || needsOnboarding ? null : (
                <>
                  <button
                    type="button"
                    className="ghost menu-action"
                    disabled={actionBusy}
                    onClick={() => void onVerifySession()}
                  >
                    Verify X API
                  </button>
                  <button
                    type="button"
                    className="ghost menu-action"
                    onClick={openUsage}
                  >
                    Usage & Billing
                  </button>
                  {authUser?.isAdmin ? (
                    <button
                      type="button"
                      className="ghost menu-action"
                      onClick={openAdmin}
                    >
                      Admin
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="primary menu-action"
                    onClick={openSettings}
                  >
                    Settings
                  </button>
                </>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {needsLogin ? (
        <Landing
          notice={authNotice}
          onGoogle={startGoogleLogin}
          onX={startXLogin}
        />
      ) : null}

      {needsOnboarding ? (
        <Onboarding
          persist={Boolean(authUser)}
          userId={authUser?.id ?? null}
          needsXHandle={Boolean(authUser) && !authUser?.xUsername}
          onComplete={finishOnboarding}
        />
      ) : null}

      {!needsLogin && !needsOnboarding ? (
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
            Your plan is a monthly credit pool of X post reads. Unused credits
            do not roll over. Hosted billing is Mergestorm, Inc.
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

      {view === "usage" || view === "admin" ? null : view === "settings" ? (
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
            Filter prefs apply on the next Scout search. Env defaults remain the
            fallback when overrides are omitted.
          </p>
          <div className="settings-grid">
            <label className="settings-field">
              <span>Max thread characters</span>
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
                <span>Drop X Articles</span>
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
          </div>
          <div className="settings-footer">
            <p className="settings-readonly">Author cooldown: 24 hours</p>
            <div className="settings-actions">
              <button
                type="button"
                className="primary"
                onClick={onSaveSettings}
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
          <nav className="desk-tabs" role="tablist" aria-label="Desk">
            <button
              type="button"
              role="tab"
              aria-selected={deskTab === "agent"}
              className={deskTab === "agent" ? "desk-tab is-on" : "desk-tab"}
              onClick={() => setDeskTab("agent")}
            >
              Agent
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={deskTab === "threads"}
              className={deskTab === "threads" ? "desk-tab is-on" : "desk-tab"}
              onClick={() => setDeskTab("threads")}
            >
              Threads
            </button>
          </nav>
        <div className={`dashboard is-${deskTab}`}>
          <section className="panel control-pane">
            <h2>Agenda</h2>
            <textarea
              className="agenda"
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              placeholder="What should we look for and how should we sound?"
            />
            <div className="scout-controls">
              {searching ? (
                <button
                  type="button"
                  className="primary scout-run"
                  onClick={onStopScout}
                >
                  Stop Scout
                </button>
              ) : (
                <button
                  type="button"
                  className="primary scout-run"
                  disabled={searchBlocked || !agenda.trim()}
                  onClick={onSearch}
                >
                  {searchCooldownRemaining > 0
                    ? `Wait ${searchCooldownRemaining}s`
                    : "Start Scout"}
                </button>
              )}
              <button
                type="button"
                className="scout-options-toggle"
                aria-expanded={scoutOptionsOpen}
                aria-controls="scout-options"
                onClick={() => setScoutOptionsOpen((open) => !open)}
              >
                Scout options
                <span aria-hidden="true">{scoutOptionsOpen ? "▴" : "▾"}</span>
              </button>
              {scoutOptionsOpen ? (
                <div id="scout-options" className="scout-options">
                  <label className="cool-target">
                    <span>Cool threads</span>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      step={1}
                      disabled={searching}
                      value={settings.targetCoolThreads}
                      onChange={(e) =>
                        updateTargetCoolThreads(
                          e.target.value === ""
                            ? DEFAULT_SETTINGS.targetCoolThreads
                            : Number(e.target.value),
                        )
                      }
                    />
                  </label>
                </div>
              ) : null}
            </div>
            <div className="status-stack" aria-live="polite">
              <p className="status status-hint">
                Fills a hard-filter bucket of {SCOUT_BUCKET_SIZE} candidates,
                then LLM-qualifies. Keeps going until{" "}
                {settings.targetCoolThreads} cool threads (or STOP / supply
                exhausted).
              </p>
              <p className="status status-main">
                {searchCooldownRemaining > 0 && !searching
                  ? `Wait ${searchCooldownRemaining}s before starting Scout again.`
                  : status || "\u00a0"}
              </p>
              <p className="status status-queries">
                {plannedQueries.length > 0
                  ? `Queries: ${plannedQueries.map((q) => `"${q}"`).join(" · ")}`
                  : "\u00a0"}
              </p>
            </div>
            <div
              className={searching ? "scout-strip active" : "scout-strip"}
            >
              <div className="scout-strip-head">
                <span className="scout-label">Scout</span>
                <span className="scout-stage">
                  {scoutStage === "error"
                    ? status || scoutStageMessage("error")
                    : scoutStage
                      ? scoutStageMessage(scoutStage)
                      : searching
                        ? status
                        : "Idle — ready when you start Scout"}
                </span>
              </div>
              <div
                className={searching ? "scout-bar" : "scout-bar idle"}
                aria-hidden="true"
              />
              {(() => {
                const pageCount = Math.max(
                  1,
                  Math.ceil(scoutLog.length / SCOUT_LOG_PAGE_SIZE) || 1,
                );
                const page = Math.min(scoutLogPage, pageCount - 1);
                const end = scoutLog.length - page * SCOUT_LOG_PAGE_SIZE;
                const start = Math.max(0, end - SCOUT_LOG_PAGE_SIZE);
                // Newest first: sort by timestamp (don't rely only on append order).
                const pageEntries = scoutLog
                  .slice(start, end)
                  .sort(
                    (a, b) =>
                      Date.parse(b.at) - Date.parse(a.at) ||
                      b.message.localeCompare(a.message),
                  );
                return (
                  <div className="scout-log-panel">
                    <ul className="scout-log">
                      {pageEntries.length > 0 ? (
                        pageEntries.map((entry) => {
                          const ago = formatTimeAgo(entry.at, nowMs);
                          const absolute = formatAbsoluteTime(entry.at);
                          return (
                            <li
                              key={`${entry.at}-${entry.stage ?? ""}-${entry.message}`}
                            >
                              <span
                                className="scout-log-ago"
                                title={absolute ?? undefined}
                              >
                                {ago ?? "—"}
                              </span>
                              <span className="scout-log-msg" title={entry.message}>{entry.message}</span>
                            </li>
                          );
                        })
                      ) : (
                        <li className="scout-log-empty">
                          Stage log appears here
                        </li>
                      )}
                    </ul>
                    <div className="scout-log-pager">
                      <button
                        type="button"
                        className="ghost scout-log-page-btn"
                        disabled={page >= pageCount - 1 || scoutLog.length === 0}
                        onClick={() => setScoutLogPage((p) => p + 1)}
                      >
                        Older
                      </button>
                      <span className="scout-log-page-label">
                        {scoutLog.length === 0
                          ? "0"
                          : `${page + 1}/${pageCount} · ${scoutLog.length}`}
                      </span>
                      <button
                        type="button"
                        className="ghost scout-log-page-btn"
                        disabled={page <= 0}
                        onClick={() =>
                          setScoutLogPage((p) => Math.max(0, p - 1))
                        }
                      >
                        Newer
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </section>

          <section className="threads-pane">
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
                  Curated
                  {curatedThreads.length > 0
                    ? ` (${curatedThreads.length})`
                    : ""}
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
                  {interactedHistory.length > 0
                    ? ` (${interactedHistory.length})`
                    : ""}
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
                  {skippedHistory.length > 0
                    ? ` (${skippedHistory.length})`
                    : ""}
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
                  {dismissedHistory.length > 0
                    ? ` (${dismissedHistory.length})`
                    : ""}
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
                  {expiredHistory.length > 0
                    ? ` (${expiredHistory.length})`
                    : ""}
                </button>
              </div>
            </div>
            <div className="threads-activity" aria-label="Activity dashboard">
              <div className="threads-activity-head">
                <div className="threads-activity-copy">
                  <span className="threads-activity-title">Activity</span>
                  <span className="threads-activity-sub">
                    From marked replies (1h/24h samples)
                  </span>
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
                    Mark interacted replies to track activity here.
                  </p>
                ) : (
                  <ActivityChart
                    series={activityStats.series}
                    bucket={activityStats.bucket}
                  />
                )}
              </div>
            </div>
            <div className="threads-scroll">
              {threadsTab === "curated" ? (
                curatedThreads.length === 0 ? (
                  <p className="empty">
                    {searching
                      ? "Scout is working…"
                      : "No curated threads yet. Set an agenda and search."}
                  </p>
                ) : (
                  <div className="threads">
                    {sortThreadsByCreatedAtNewest(curatedThreads).map((t) => (
                      <ThreadRow
                        key={t.id}
                        thread={t}
                        open={expandedId === t.id}
                        busy={actionBusy}
                        interacted={interactedIds.has(t.id)}
                        onToggle={() =>
                          setExpandedId(expandedId === t.id ? null : t.id)
                        }
                        onMark={() => onMark(t)}
                        onSkip={() => void onSkip(t)}
                        onDismiss={() => openDismissModal(t)}
                      />
                    ))}
                  </div>
                )
              ) : threadsTab === "interacted" ? (
                interactedHistory.length === 0 ? (
                  <p className="empty">
                    No interacted threads yet. Mark a curated lead after you reply
                    on X.
                  </p>
                ) : (
                  <div className="threads">
                    {interactedHistory.map((entry) => (
                      <InteractedRow
                        key={entry.threadId}
                        entry={entry}
                      />
                    ))}
                  </div>
                )
              ) : threadsTab === "skipped" ? (
                skippedHistory.length === 0 ? (
                  <p className="empty">
                    No skipped threads yet. Skip a curated lead to pass on it
                    without dismissing the author.
                  </p>
                ) : (
                  <div className="threads">
                    {skippedHistory.map((entry) => (
                      <SkippedRow key={entry.threadId} entry={entry} />
                    ))}
                  </div>
                )
              ) : threadsTab === "dismissed" ? (
                dismissedHistory.length === 0 ? (
                  <p className="empty">
                    No dismissed threads yet. Mark a curated lead as not interested
                    to dismiss it with an optional reason.
                  </p>
                ) : (
                  <div className="threads">
                    {dismissedHistory.map((entry) => (
                      <DismissedRow key={entry.threadId} entry={entry} />
                    ))}
                  </div>
                )
              ) : expiredHistory.length === 0 ? (
                <p className="empty">
                  No expired threads yet. Cool leads older than 24h move here
                  automatically.
                </p>
              ) : (
                <div className="threads">
                  {expiredHistory.map((entry) => (
                    <ExpiredRow key={entry.threadId} entry={entry} />
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

      {markThread ? (
        <div className="modal-root" role="presentation">
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Cancel mark interacted"
            disabled={actionBusy}
            onClick={closeMarkModal}
          />
          <div
            className="modal-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mark-reply-title"
          >
            <h2 id="mark-reply-title">Mark interacted</h2>
            <p className="status">
              {markDetectNote ||
                `Reply you posted on X for ${markThread.author}. Optional reply text is saved to local knowledge memory.`}
            </p>
            <label className="settings-field">
              <span>Reply URL on X</span>
              <input
                className="mark-reply-url"
                type="url"
                value={markReplyUrl}
                onChange={(e) => setMarkReplyUrl(e.target.value)}
                placeholder="https://x.com/you/status/…"
                autoFocus
                disabled={actionBusy}
              />
            </label>
            <label className="settings-field">
              <span>Reply text (optional, for memory)</span>
              <textarea
                className="mark-reply-text"
                value={markReply}
                onChange={(e) => setMarkReply(e.target.value)}
                placeholder="What you actually typed / posted…"
                rows={4}
                disabled={actionBusy}
              />
            </label>
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={
                  actionBusy ||
                  markDetecting ||
                  !parseStatusIdFromUrl(markReplyUrl)
                }
                onClick={() => void confirmMarkInteracted()}
              >
                {markDetecting ? "Checking…" : "Confirm"}
              </button>
              {markDetectMissed && !markDetecting ? (
                <button
                  type="button"
                  className="ghost"
                  disabled={actionBusy}
                  onClick={() => retryMarkDetect()}
                >
                  Retry
                </button>
              ) : null}
              <button
                type="button"
                className="ghost"
                disabled={actionBusy}
                onClick={closeMarkModal}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dismissThread ? (
        <div className="modal-root" role="presentation">
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Cancel not interested"
            disabled={actionBusy}
            onClick={closeDismissModal}
          />
          <div
            className="modal-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dismiss-title"
          >
            <h2 id="dismiss-title">Not interested</h2>
            <p className="status">
              Dismiss {dismissThread.author} from Curated. Optional reason is
              saved to local knowledge memory.
            </p>
            <label className="settings-field">
              <span>Reason (optional)</span>
              <textarea
                className="mark-reply-text"
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                placeholder="Why skip this lead…"
                rows={3}
                autoFocus
              />
            </label>
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={actionBusy}
                onClick={() => void confirmDismiss()}
              >
                Confirm
              </button>
              <button
                type="button"
                className="ghost"
                disabled={actionBusy}
                onClick={closeDismissModal}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
