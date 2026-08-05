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
  formatExcludedTagsText,
  normalizePreferredLanguage,
  parseExcludedTagsText,
  threadHasExcludedTag,
  PREFERRED_LANGUAGES,
  DEFAULT_SETTINGS,
} from "./lib/settings";
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

/** Hard-filter candidate bucket size sent on each Scout run. */
const SCOUT_BUCKET_SIZE = 20;

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
  /** Native media t.co keys (lowercased); hide from card text display. */
  mediaShortlinks?: string[];
  /** 0–100, higher = more engagement bait. */
  baitScore?: number;
  flags?: string[];
  intent?: string;
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
  stopReason?: "qualified" | "target" | "exhausted" | "aborted";
  candidates?: number;
  bucketSize?: number;
  triageWarning?: string;
  cooldownWarning?: string;
  linkWarning?: string;
  linkFiltered?: number;
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
  const tags = [...new Set([thread.intent, ...(thread.flags ?? [])].filter(Boolean))];
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

type AppView = "dashboard" | "settings";

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
  const [view, setView] = useState<AppView>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuEntered, setMenuEntered] = useState(false);
  const [sessionUser, setSessionUser] = useState<{
    screen_name: string;
    name: string;
  } | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(() =>
    loadSettings(),
  );
  /** Raw excluded-tags textarea; normalize only on Save (spaces/_ mid-edit). */
  const [excludedTagsDraft, setExcludedTagsDraft] = useState(() =>
    formatExcludedTagsText(loadSettings().excludedTags),
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
    void fetch("/api/scout/log", {
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
      const res = await fetch("/api/scout/log");
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
      const res = await fetch("/api/interacted");
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
    const next = await fetchGamification();
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
    return (
      !isHiddenFromCurated(thread.id) &&
      !threadHasExcludedTag(thread, excludedTags)
    );
  }

  const curatedThreads = threads.filter((t) => keepInCurated(t));

  async function hydrateSkipped() {
    try {
      const res = await fetch("/api/skipped");
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
      const res = await fetch("/api/dismissed");
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
      if (ids.size) {
        setThreads((prev) => prev.filter((t) => !isHiddenFromCurated(t.id)));
      }
    } catch {
      // Sidecar may be offline on first paint — ignore.
    }
  }

  async function hydrateExpired() {
    try {
      const res = await fetch("/api/expired");
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
      const res = await fetch(`/api/scout/last?dedupeAccounts=${settings.dedupeAccounts}`);
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

  useEffect(() => {
    void (async () => {
      await hydrateDismissed();
      await hydrateSkipped();
      await hydrateInteracted();
      await hydrateActivityStats();
      await hydrateGamification();
      await hydrateExpired();
      await hydrateLastScout();
      await hydrateScoutLog();
    })();
  }, []);

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
    setMarkDetectNote("Looking for your reply…");
    try {
      const res = await fetch("/api/interacted/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: thread.id }),
        signal: ac.signal,
      });
      if (markDetectGenRef.current !== gen) return;
      const data = (await res.json().catch(() => ({}))) as {
        found?: boolean;
        reply?: { replyUrl?: string; replyText?: string };
        message?: string;
      };
      if (markDetectGenRef.current !== gen) return;
      if (!res.ok) {
        setMarkDetectMissed(true);
        setMarkDetectNote(
          "Detection unavailable — server error. Paste the URL manually.",
        );
      } else if (
        data.found &&
        typeof data.reply?.replyUrl === "string" &&
        parseStatusIdFromUrl(data.reply.replyUrl)
      ) {
        setMarkReplyUrl(data.reply.replyUrl);
        setMarkReply(
          typeof data.reply.replyText === "string" ? data.reply.replyText : "",
        );
        setMarkDetectMissed(false);
        setMarkDetectNote("Found your reply — confirm or edit before saving.");
      } else {
        setMarkDetectMissed(true);
        setMarkDetectNote(
          "Couldn't find your reply — paste the URL (text optional).",
        );
      }
    } catch (err) {
      if (markDetectGenRef.current !== gen) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      setMarkDetectMissed(true);
      setMarkDetectNote(
        "Couldn't find your reply — paste the URL (text optional).",
      );
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
      const res = await fetch("/api/interacted", {
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
      interactedIdsRef.current = new Set(interactedIdsRef.current).add(thread.id);
      setInteractedIds((prev) => new Set(prev).add(thread.id));
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
      };
      setInteractedHistory((prev) => [
        historyEntry,
        ...prev.filter((i) => i.threadId !== thread.id),
      ]);
      // Drop this author from Curated so we stop engaging the same account.
      setThreads((prev) => prev.filter((t) => normalizeAuthorKey(t.author) !== key));
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
      const res = await fetch("/api/session/verify");
      const data = (await res.json()) as {
        ok?: boolean;
        user?: { screen_name: string; name: string };
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setSessionUser(null);
        setStatus(`Session fail: ${data.message || data.error || res.status}`);
        return;
      }
      if (data.user?.screen_name) {
        setSessionUser({
          screen_name: data.user.screen_name,
          name: data.user.name ?? data.user.screen_name,
        });
      }
      setStatus(`Session OK — @${data.user?.screen_name} (${data.user?.name})`);
      closeMenu();
    } catch {
      setSessionUser(null);
      setStatus("Sidecar offline — run ./pm2-manager.sh restart or npm run dev:server");
    } finally {
      setActionBusy(false);
    }
  }

  function openSettings() {
    setSettingsDraft(settings);
    setExcludedTagsDraft(formatExcludedTagsText(settings.excludedTags));
    setSettingsStatus("");
    setView("settings");
    closeMenu();
  }

  function onSaveSettings() {
    const next = saveSettings({
      ...settingsDraft,
      excludedTags: parseExcludedTagsText(excludedTagsDraft),
    });
    setSettings(next);
    setSettingsDraft(next);
    setExcludedTagsDraft(formatExcludedTagsText(next.excludedTags));
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
      const res = await fetch("/api/scout/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({
          agenda,
          targetCool,
          bucketSize: SCOUT_BUCKET_SIZE,
          filters: {
            maxThreadChars: settings.maxThreadChars,
            dropArticles: settings.dropArticles,
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
          const res = await fetch(
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
      const res = await fetch("/api/skipped", {
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
      const res = await fetch("/api/dismissed", {
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
      const entry: DismissalHistoryEntry = data.dismissal ?? {
        threadId: thread.id,
        author: thread.author,
        at: new Date().toISOString(),
        url: thread.url,
        summary: thread.summary,
        text: thread.text,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      };
      dismissedIdsRef.current = new Set(dismissedIdsRef.current).add(thread.id);
      setDismissedHistory((prev) => [
        entry,
        ...prev.filter((d) => d.threadId !== thread.id),
      ]);
      setThreads((prev) => prev.filter((t) => t.id !== thread.id));
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

  return (
    <div className="app">
      <header className="brand">
        <div className="brand-bar">
          <div className="brand-copy">
            <h1>x-copilot</h1>
            <p>
              Agenda → Scout searches X and scores threads. You review and post.
            </p>
          </div>
          <button
            type="button"
            className="menu-toggle"
            aria-label={menuOpen && menuEntered ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen && menuEntered}
            onClick={() => {
              if (menuOpen && menuEntered) closeMenu();
              else openMenu();
            }}
          >
            <span aria-hidden="true">
              {menuOpen && menuEntered ? "✕" : "☰"}
            </span>
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
              <h2>Menu</h2>
              <button type="button" className="ghost" onClick={closeMenu}>
                Close
              </button>
            </div>
            <p className="menu-session">
              {sessionUser
                ? `@${sessionUser.screen_name} · ${sessionUser.name}`
                : "Session not verified"}
            </p>
            <div className="menu-actions">
              <button
                type="button"
                className="ghost menu-action"
                disabled={actionBusy}
                onClick={() => void onVerifySession()}
              >
                Verify session
              </button>
              <button
                type="button"
                className="primary menu-action"
                onClick={openSettings}
              >
                Settings
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {view === "settings" ? (
        <section className="panel settings-pane">
          <div className="settings-head">
            <h2>Settings</h2>
            <button
              type="button"
              className="ghost"
              onClick={() => setView("dashboard")}
            >
              Back
            </button>
          </div>
          <p className="status">
            Filter prefs apply on the next Scout search. Env defaults remain the
            fallback when overrides are omitted.
          </p>
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
          <label className="settings-field">
            <span>Preferred language</span>
            <select
              className="settings-select"
              value={settingsDraft.preferredLanguage}
              onChange={(e) =>
                setSettingsDraft((prev) => ({
                  ...prev,
                  preferredLanguage: normalizePreferredLanguage(e.target.value),
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
                  readonly [ (typeof PREFERRED_LANGUAGES)[number], string ]
                >
              ).map(([code, label]) => (
                <option key={code} value={code}>
                  {label} ({code})
                </option>
              ))}
            </select>
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
            <span>Excluded tags (one per line)</span>
            <textarea
              className="settings-textarea"
              rows={4}
              value={excludedTagsDraft}
              onChange={(e) => setExcludedTagsDraft(e.target.value)}
              placeholder="supportive_encouragement"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
            <span className="settings-help">
              Still tagged by triage; dropped from Curated. Matches flags and
              intent (spaces become underscores on Save). Empty list disables
              tag excludes.
            </span>
          </label>
          <p className="settings-readonly">Author cooldown: 24 hours</p>
          <div className="row">
            <button type="button" className="primary" onClick={onSaveSettings}>
              Save
            </button>
          </div>
          {settingsStatus ? <p className="status">{settingsStatus}</p> : null}
        </section>
      ) : (
        <div className="dashboard">
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
      )}

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
                {markDetecting ? "Looking…" : "Confirm"}
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
