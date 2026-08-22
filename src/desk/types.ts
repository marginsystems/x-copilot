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
  isQuote?: boolean;
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

export type ScoutLogEntry = {
  at: string;
  message: string;
  stage?: string;
};

export type ReplyStatSnapshot = {
  views?: number;
  likes?: number;
  replies?: number;
  retweets?: number;
  sampledAt: string;
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
};

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
