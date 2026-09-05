/**
 * Shared scout/search card shape. Importers can take this without pulling
 * the X search client. threadTriage owns ThreadKind; we only type-import it
 * so the cycle stays one-way.
 */
import type { ThreadKind } from "./threadTriage.js";

export type ThreadCard = {
  id: string;
  author: string;
  text: string;
  url: string;
  createdAt?: string;
  /**
   * Set when search/lookup exposed longform / Article payload.
   * Articles are hard-dropped before triage; note_tweet body feeds the char cap.
   */
  longform?: "note_tweet" | "article";
  /**
   * True when the candidate or its OP/quoted root has an off-platform link
   * (entities, card, or text). Native media and x.com / twitter.com URLs do
   * not count. Hard-dropped before triage.
   */
  hasOutboundLink?: boolean;
  /**
   * True when the author has X's Automated badge
   * (`affiliates_highlighted_label.label.userLabelType === "AutomatedLabel"`).
   * Hard-dropped before triage when Settings dropAutomatedAccounts is on.
   */
  isAutomated?: boolean;
  /** t.co shortlink keys (lowercased `t.co/<code>`) that resolve to native media. */
  mediaShortlinks?: string[];
  /** Native media is present even when no media URL entity is exposed. */
  hasNativeMedia?: boolean;
  /** Native media was present on a hydrated parent tweet. */
  opHasNativeMedia?: boolean;
  /** Reply / conversation context for triage (OP scoring). */
  inReplyToId?: string;
  /** Screen name of the tweet being replied to (SearchTimeline legacy). */
  inReplyToScreenName?: string;
  conversationId?: string;
  isReply?: boolean;
  /** True when the card is a quote tweet (own referenced_tweets / quoted payload). */
  isQuote?: boolean;
  /** Parent or quoted root author/text when available. */
  opAuthor?: string;
  opText?: string;
  /** Parent longform when the hydrated / included OP is a note tweet or Article. */
  opLongform?: "note_tweet" | "article";
  /** Full parent text length (opText is sliced to MAX_OP_TEXT_CHARS). */
  opCharCount?: number;
  /** True when opAuthor/opText were filled from the reply parent by hydrateReplyParents. */
  opParentDerived?: boolean;
  /** Impression count on this card when search/lookup exposed it. */
  views?: number;
  /** Impression count on the hydrated / included OP. */
  opViews?: number;
  /** Triage fields (filled by threadTriage after search). */
  summary?: string;
  /** 0–100, higher = more engagement bait / less worth replying to. */
  baitScore?: number;
  flags?: string[];
  intent?: string;
  /** Closed preference category from triage (see THREAD_KINDS). */
  threadKind?: ThreadKind;
  engage?: "skip" | "consider" | "priority";
  /** True when triage said the conversation is on the operator agenda. */
  onAgenda?: boolean;
  /** Whether this card was cooled during a run that supplied an agenda. */
  scoutAgendaSet?: boolean;
  reason?: string;
  /** Mirrors baitScore for the existing card meta line. */
  score?: number;
};

export const MAX_OP_TEXT_CHARS = 500;

export function dedupeThreads(threads: ThreadCard[]): ThreadCard[] {
  const seen = new Set<string>();
  const out: ThreadCard[] = [];
  for (const t of threads) {
    if (!t.id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}
