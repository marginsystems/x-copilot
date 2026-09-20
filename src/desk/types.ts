import type { ScoutStageId } from "../lib/scoutStages";

/** Closed preference category from triage (mirrors server THREAD_KINDS). */
export type ThreadKind =
  | "timely_take"
  | "fact_add"
  | "sharp_opinion"
  | "lived_answer"
  | "hollow_ask"
  | "promo_context"
  | "bare_news"
  | "closed_thread"
  | "other";

export type ThreadCard = {
  id: string;
  author: string;
  text: string;
  url: string;
  surface?: "reply" | "repost";
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
  /** Screen name of the status being replied to, when known. */
  inReplyToScreenName?: string;
  isQuote?: boolean;
  /** Native media t.co keys (lowercased); hide from card text display. */
  mediaShortlinks?: string[];
  hasNativeMedia?: boolean;
  /** 0–100, higher = more engagement bait. */
  baitScore?: number;
  flags?: string[];
  intent?: string;
  threadKind?: ThreadKind;
  engage?: "skip" | "consider" | "priority";
  reason?: string;
  score?: number;
  /** Impression count when Scout had it. Used to pick the highest-view OP. */
  views?: number;
  /** Conversation-root impression count when the card is still a leftover leaf. */
  opViews?: number;
  /** True when OP context was derived while hydrating a reply. */
  opParentDerived?: boolean;
};

export type ScoutStreamEvent = {
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
  profanityWarning?: string;
  profanityFiltered?: number;
  automatedWarning?: string;
  excludedAccountWarning?: string;
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

export type ReplyStatSnapshot = {
  views?: number;
  likes?: number;
  replies?: number;
  retweets?: number;
  sampledAt: string;
};

/** Honest saved-memory receipt from boot / GET history. Paths stay off the desk. */
export type InteractionMemoryState = "saved" | "unavailable" | "no_reply_text";

export type InteractionMemoryReceipt = {
  state: InteractionMemoryState;
};

export type InteractionHistoryEntry = {
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
  memory?: InteractionMemoryReceipt;
};

export function parseInteractionMemoryReceipt(
  raw: unknown,
): InteractionMemoryReceipt | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const state = (raw as { state?: unknown }).state;
  if (
    state === "saved" ||
    state === "unavailable" ||
    state === "no_reply_text"
  ) {
    return { state };
  }
  return undefined;
}

export function parseInteractionHistoryEntry(
  raw: unknown,
): InteractionHistoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (
    typeof row.threadId !== "string" ||
    typeof row.author !== "string" ||
    typeof row.at !== "string"
  ) {
    return null;
  }
  const memory = parseInteractionMemoryReceipt(row.memory);
  const entry = raw as InteractionHistoryEntry;
  if (memory) return { ...entry, memory };
  if ("memory" in entry) {
    const { memory: _drop, ...rest } = entry;
    return rest;
  }
  return entry;
}

export function hasSavedInteractionMemory(
  entry: Pick<InteractionHistoryEntry, "memory">,
): boolean {
  return entry.memory?.state === "saved";
}

export type ThreadsTab =
  | "curated"
  | "interacted"
  | "skipped"
  | "dismissed"
  | "expired";

export type DismissalHistoryEntry = {
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

export type SkipHistoryEntry = {
  threadId: string;
  author: string;
  at: string;
  url?: string;
  summary?: string;
  text?: string;
  conversationId?: string;
  inReplyToId?: string;
};

export type ExpiredHistoryEntry = {
  threadId: string;
  author: string;
  at: string;
  createdAt?: string;
  url?: string;
  summary?: string;
  text?: string;
};
