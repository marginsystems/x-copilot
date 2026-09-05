import type { LlmProvider, TokenUsage } from "./deepseek.js";
import type { OpenCodeTurn } from "./opencodeAdapter.js";
import type { ThreadCard } from "./threadCard.js";

export type ScoutStageId =
  | "planning"
  | "searching"
  | "filtering"
  | "triaging"
  | "done"
  | "error";

export type ScoutPipelineCounts = {
  raw: number;
  afterDedupe: number;
  afterCooldown: number;
  afterSelfReply: number;
  afterLinks: number;
  afterLength: number;
  afterHydrateSelfReply: number;
  afterTriage: number;
  minViewsFiltered?: number;
};

export type ScoutFilters = {
  maxThreadChars?: number;
  dropArticles?: boolean;
  /** When true (default), hard-drop website cards and URL-entity outbound links. */
  dropOutboundLinks?: boolean;
  /** When true (default), hard-drop posts with a native photo, GIF, or video. */
  dropNativeMedia?: boolean;
  /** When true (default), hard-drop posts whose text or OP text has a hashtag. */
  dropHashtags?: boolean;
  /** When true (default), hard-drop posts containing an em dash (U+2014). */
  dropEmDashes?: boolean;
  /** When true (default), hard-drop posts whose candidate or OP text has swears. */
  dropProfanity?: boolean;
  /** When true (default), hard-drop authors with X's Automated badge. */
  dropAutomatedAccounts?: boolean;
  /** When true (default), drop posts under minViews. */
  filterByMinViews?: boolean;
  /** Inclusive view floor when filterByMinViews is on. Default 100. */
  minViews?: number;
  /** When true (default), never curate authors from interaction history. */
  dedupeAccounts?: boolean;
  /** ISO 639-1; default English when omitted. */
  preferredLanguage?: string;
  /**
   * Post-triage Curated excludes (flags + normalized intent).
   * Omit → server default (`supportive_encouragement`, `political`,
   * `interpersonal_conflict`); `[]` → no tag excludes.
   */
  excludedTags?: string[];
  /**
   * Pre-triage author excludes (handles, no @).
   * Omit → default chatbot list; `[]` → no handle excludes.
   */
  excludedAccounts?: string[];
  /** Standing never-show rules for triage. Empty/omit = unused. Capped at 300. */
  avoidPrompt?: string;
};

export type ScoutStopReason =
  | "qualified"
  | "exhausted"
  | "aborted"
  | "target"
  | "rate_limited"
  | "terminal_error"
  | "credits_exhausted";

export type ScoutCollectStageId =
  | "planning"
  | "searching"
  | "filtering"
  | "triaging"
  | "partial"
  | "done"
  | "error";

export type ScoutCollectEvent = {
  agent: "scout";
  stage: ScoutCollectStageId;
  message: string;
  detail?: unknown;
  at: string;
  threads?: ThreadCard[];
  queries?: string[];
  coolCount?: number;
  targetCool?: number;
  bucketSize?: number;
  candidates?: number;
  stopReason?: ScoutStopReason;
  triageWarning?: string;
  linkFiltered?: number;
  linkWarning?: string;
  emDashFiltered?: number;
  emDashWarning?: string;
  profanityFiltered?: number;
  profanityWarning?: string;
  automatedFiltered?: number;
  automatedWarning?: string;
  excludedAccountFiltered?: number;
  excludedAccountWarning?: string;
  languageFiltered?: number;
  minViewsFiltered?: number;
  minViewsWarning?: string;
  pipelineCounts?: ScoutPipelineCounts;
  errors?: Array<{ query: string; message: string }>;
  plannedBy?: "client" | LlmProvider;
  model?: string;
  llmProvider?: LlmProvider;
  llmUsage?: TokenUsage;
  unhydratedReplyCount?: number;
  opencodeTurns?: OpenCodeTurn[];
};
