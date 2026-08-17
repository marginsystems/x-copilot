/**
 * Deterministic post-search filters (length / thread openers / Articles +
 * replies under them / self-replies / links / language) before triage.
 */
import { franc } from "franc-min";
import { normalizeAuthorKey } from "./interactionStore.js";
import { parseXHandle } from "./xHandle.js";
import { textHasOutboundLink, type ThreadCard } from "./xSearch.js";

export const DEFAULT_MAX_THREAD_CHARS = 480;

/** ISO 639-1 allowlist. Keep in sync with `PREFERRED_LANGUAGES` in src/lib/settings.ts. */
export const PREFERRED_LANGUAGE_CODES = ["en", "es", "fr", "de", "pt"] as const;
export type PreferredLanguageCode = (typeof PREFERRED_LANGUAGE_CODES)[number];
export const DEFAULT_PREFERRED_LANGUAGE: PreferredLanguageCode = "en";

/**
 * Post-triage Curated excludes (match flags + normalized intent).
 * Keep defaults/token rules in sync with `src/lib/settings.ts`.
 */
export const DEFAULT_EXCLUDED_TAGS = [
  "supportive_encouragement",
  "political",
] as const;
/** Pre-political default — upgrade on load when storage still matches this. */
export const LEGACY_DEFAULT_EXCLUDED_TAGS = ["supportive_encouragement"] as const;
export const MAX_EXCLUDED_TAGS = 20;
export const MAX_TAG_TOKEN_LEN = 40;

/**
 * Pre-triage author excludes. Chatbot product accounts — not company news
 * handles. Keep in sync with `DEFAULT_EXCLUDED_ACCOUNTS` in src/lib/settings.ts.
 */
export const DEFAULT_EXCLUDED_ACCOUNTS = [
  "grok",
  "chatgpt",
  "chatgptapp",
  "claudeai",
  "geminiapp",
  "metaai",
  "copilot",
  "perplexity_ai",
] as const;
export const MAX_EXCLUDED_ACCOUNTS = 40;

/**
 * Known excludeable tokens for Settings autocomplete / picker.
 * Official triage flags + common intent-shaped excludes.
 * Keep in sync with `EXCLUDEABLE_TAG_VOCAB` in `src/lib/settings.ts`
 * and the flags list in `TRIAGE_SYSTEM_PROMPT`.
 */
export const EXCLUDEABLE_TAG_VOCAB = [
  "engagement_bait",
  "generic_question",
  "promo",
  "promo_op",
  "event_promo",
  "bad_context",
  "github_plug",
  "low_substance",
  "thread_farm",
  "wall_of_text",
  "giveaway",
  "rage_bait",
  "on_agenda",
  "genuine_question",
  "political",
  "interpersonal_conflict",
  "supportive_encouragement",
] as const;

/** ISO 639-1 → ISO 639-3 for franc-min. */
const LANG1_TO_3: Record<PreferredLanguageCode, string> = {
  en: "eng",
  es: "spa",
  fr: "fra",
  de: "deu",
  pt: "por",
};

const FRANC_ONLY = Object.values(LANG1_TO_3);
/** Below this, franc is unreliable — keep the card. */
export const LANGUAGE_MIN_CHARS = 40;

const THREAD_OPENER_RE = /^\s*\d+\s*\/\s*\d+/;

export type LengthFilterOptions = {
  /** When true (default), hard-drop X Articles and replies under them. */
  dropArticles?: boolean;
  /** Article conversation / status ids from earlier pages this Scout run. */
  articleIds?: ReadonlySet<string>;
};

/** Parse X_MAX_THREAD_CHARS; invalid/empty → default 480. */
export function resolveMaxThreadChars(envValue?: string): number {
  const raw = (envValue ?? "").trim();
  if (!raw) return DEFAULT_MAX_THREAD_CHARS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_MAX_THREAD_CHARS;
  return n;
}

/** Prefer request override, then env, then default. */
export function resolveMaxThreadCharsFromFilters(
  override?: number,
  envValue?: string,
): number {
  if (typeof override === "number" && Number.isInteger(override) && override > 0) {
    return override;
  }
  return resolveMaxThreadChars(envValue);
}

export function isOversizedThread(text: string, maxChars: number): boolean {
  return text.length > maxChars;
}

function isReplyCard(
  thread: Pick<ThreadCard, "isReply" | "inReplyToId">,
): boolean {
  return thread.isReply === true || Boolean(thread.inReplyToId);
}

/** Full parent length when known; `opText` is a sliced preview. */
export function parentCharCount(
  thread: Pick<ThreadCard, "opCharCount" | "opText">,
): number {
  if (
    typeof thread.opCharCount === "number" &&
    Number.isFinite(thread.opCharCount) &&
    thread.opCharCount >= 0
  ) {
    return thread.opCharCount;
  }
  return thread.opText?.length ?? 0;
}

/** conversationId + id for every Article card in the batch. */
export function collectArticleConversationIds(
  threads: readonly Pick<ThreadCard, "id" | "conversationId" | "longform">[],
): Set<string> {
  const ids = new Set<string>();
  for (const t of threads) {
    if (t.longform !== "article") continue;
    if (t.id) ids.add(t.id);
    if (t.conversationId) ids.add(t.conversationId);
  }
  return ids;
}

/** True for a reply under a known Article root/parent, or a hydrated Article OP. */
export function replyUnderArticle(
  thread: Pick<
    ThreadCard,
    "isReply" | "inReplyToId" | "conversationId" | "opLongform"
  >,
  articleIds: ReadonlySet<string>,
): boolean {
  if (thread.opLongform === "article") return isReplyCard(thread);
  if (!articleIds.size) return false;
  if (!isReplyCard(thread)) return false;
  if (thread.conversationId && articleIds.has(thread.conversationId)) {
    return true;
  }
  if (thread.inReplyToId && articleIds.has(thread.inReplyToId)) return true;
  return false;
}

/** Obvious multi-part openers like "1/17 Here's the thread". */
export function isThreadOpener(text: string): boolean {
  return THREAD_OPENER_RE.test(text) && /\bthread\b/i.test(text);
}

/**
 * True when the card is a same-account reply (self-thread mid-posts).
 * Either signal is enough (no fuzzy heuristics):
 * - `inReplyToScreenName` matches `author`, or
 * - reply-parent-derived `opAuthor` (via `hydrateReplyParents`) matches `author`.
 * Quote-derived `opAuthor` is not a self-reply signal.
 * Missing both → false.
 */
export function isSelfReply(thread: ThreadCard): boolean {
  const authorKey = normalizeAuthorKey(thread.author);
  if (!authorKey) return false;
  const replyToKey = normalizeAuthorKey(thread.inReplyToScreenName ?? "");
  if (replyToKey && replyToKey === authorKey) return true;
  if (!thread.opParentDerived) return false;
  const opKey = normalizeAuthorKey(thread.opAuthor ?? "");
  return Boolean(opKey && opKey === authorKey);
}

/** Hard-drop self-replies (pre- and/or post-hydrate). */
export function filterSelfReplies(threads: ThreadCard[]): {
  threads: ThreadCard[];
  selfReplyFilteredCount: number;
} {
  const kept: ThreadCard[] = [];
  let selfReplyFilteredCount = 0;
  for (const thread of threads) {
    if (isSelfReply(thread)) {
      selfReplyFilteredCount += 1;
      continue;
    }
    kept.push(thread);
  }
  return { threads: kept, selfReplyFilteredCount };
}

/** True when the candidate has an outbound link (flag or text fallback). */
export function threadHasOutboundLink(thread: ThreadCard): boolean {
  if (thread.hasOutboundLink === true) return true;
  return textHasOutboundLink(thread.text);
}

/** Hard-drop posts with outbound links before hydrate/triage. */
export function filterOutboundLinks(threads: ThreadCard[]): {
  threads: ThreadCard[];
  linkFilteredCount: number;
} {
  const kept: ThreadCard[] = [];
  let linkFilteredCount = 0;
  for (const thread of threads) {
    if (threadHasOutboundLink(thread)) {
      linkFilteredCount += 1;
      continue;
    }
    kept.push(thread);
  }
  return { threads: kept, linkFilteredCount };
}

/** Typographic em dash (U+2014) — common AI-slop tell. */
export const EM_DASH = "\u2014";

export function textHasEmDash(text: string): boolean {
  return text.includes(EM_DASH);
}

export type EmDashFilterOptions = {
  /** When true (default), hard-drop posts whose card text contains an em dash. */
  dropEmDashes?: boolean;
};

/** Hard-drop em-dash posts before length/triage (Settings default on). */
export function filterEmDashes(
  threads: ThreadCard[],
  opts: EmDashFilterOptions = {},
): {
  threads: ThreadCard[];
  emDashFilteredCount: number;
} {
  const drop = opts.dropEmDashes !== false;
  if (!drop) {
    return { threads: [...threads], emDashFilteredCount: 0 };
  }
  const kept: ThreadCard[] = [];
  let emDashFilteredCount = 0;
  for (const thread of threads) {
    if (textHasEmDash(thread.text)) {
      emDashFilteredCount += 1;
      continue;
    }
    kept.push(thread);
  }
  return { threads: kept, emDashFilteredCount };
}

export type AutomatedFilterOptions = {
  /** When true (default), hard-drop authors with X's Automated badge. */
  dropAutomatedAccounts?: boolean;
};

/** Hard-drop Automated (AI/bot) accounts before length/triage (Settings default on). */
export function filterAutomatedAccounts(
  threads: ThreadCard[],
  opts: AutomatedFilterOptions = {},
): {
  threads: ThreadCard[];
  automatedFilteredCount: number;
} {
  const drop = opts.dropAutomatedAccounts !== false;
  if (!drop) {
    return { threads: [...threads], automatedFilteredCount: 0 };
  }
  const kept: ThreadCard[] = [];
  let automatedFilteredCount = 0;
  for (const thread of threads) {
    if (thread.isAutomated) {
      automatedFilteredCount += 1;
      continue;
    }
    kept.push(thread);
  }
  return { threads: kept, automatedFilteredCount };
}

/** Dedupe/normalize handles. Non-arrays → default chatbot list. */
export function normalizeExcludedAccounts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_EXCLUDED_ACCOUNTS];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const handle = parseXHandle(item)?.toLowerCase();
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    out.push(handle);
    if (out.length >= MAX_EXCLUDED_ACCOUNTS) break;
  }
  return out;
}

/** Omit → defaults. Explicit `[]` disables handle excludes. */
export function resolveExcludedAccounts(override?: string[]): string[] {
  if (override === undefined) return [...DEFAULT_EXCLUDED_ACCOUNTS];
  return normalizeExcludedAccounts(override);
}

/** Hard-drop authors on the exclude list before length/triage. */
export function filterExcludedAccounts(
  threads: ThreadCard[],
  excludedAccounts: readonly string[] = DEFAULT_EXCLUDED_ACCOUNTS,
): {
  threads: ThreadCard[];
  excludedAccountFilteredCount: number;
} {
  if (!excludedAccounts.length) {
    return { threads: [...threads], excludedAccountFilteredCount: 0 };
  }
  const blocked = new Set(
    excludedAccounts.map((h) => normalizeAuthorKey(h)).filter(Boolean),
  );
  const kept: ThreadCard[] = [];
  let excludedAccountFilteredCount = 0;
  for (const thread of threads) {
    const key = normalizeAuthorKey(thread.author);
    if (key && blocked.has(key)) {
      excludedAccountFilteredCount += 1;
      continue;
    }
    kept.push(thread);
  }
  return { threads: kept, excludedAccountFilteredCount };
}

export function normalizePreferredLanguageCode(
  value: unknown,
): PreferredLanguageCode {
  if (typeof value !== "string") return DEFAULT_PREFERRED_LANGUAGE;
  const code = value.trim().toLowerCase();
  return (PREFERRED_LANGUAGE_CODES as readonly string[]).includes(code)
    ? (code as PreferredLanguageCode)
    : DEFAULT_PREFERRED_LANGUAGE;
}

/** Normalize a flag/intent/exclude token to snake_case, or null if unusable. */
export function normalizeTagToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (!token || token.length > MAX_TAG_TOKEN_LEN) return null;
  if (!/^[a-z0-9_]+$/.test(token)) return null;
  return token;
}

/** Dedupe/normalize an exclude list. Non-arrays → default list. */
export function normalizeExcludedTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_EXCLUDED_TAGS];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const token = normalizeTagToken(item);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= MAX_EXCLUDED_TAGS) break;
  }
  return out;
}

/**
 * Prefer request override (including explicit `[]`); omit/undefined → default.
 */
export function resolveExcludedTags(override?: string[]): string[] {
  if (override === undefined) return [...DEFAULT_EXCLUDED_TAGS];
  return normalizeExcludedTags(override);
}

/** True when any flag or normalized intent is in the exclude set. */
export function threadHasExcludedTag(
  thread: Pick<ThreadCard, "flags" | "intent">,
  excludedTags: readonly string[],
): boolean {
  if (!excludedTags.length) return false;
  const excluded = new Set(excludedTags);
  for (const flag of thread.flags ?? []) {
    const token = normalizeTagToken(flag);
    if (token && excluded.has(token)) return true;
  }
  const intent = normalizeTagToken(thread.intent);
  return Boolean(intent && excluded.has(intent));
}

/**
 * Flags that mark a conversation root/OP as engagement bait (or similarly
 * worthless to enter). Used to suppress sibling replies under that root.
 */
export const BAIT_CONVERSATION_FLAGS = [
  "engagement_bait",
  "promo_op",
  "bad_context",
  "giveaway",
  "rage_bait",
] as const;

/**
 * Promo / bad-OP flags — never cool even if engage is consider/priority.
 * Keep in sync with TRIAGE_SYSTEM_PROMPT promo_op / bad_context guidance.
 */
export const COOL_SKIP_PROMO_FLAGS = [
  "promo_op",
  "bad_context",
  "promo_context",
] as const;

/** True when triage flagged the card as under/being a promo OP. */
export function threadHasCoolSkipPromoFlag(
  thread: Pick<ThreadCard, "flags">,
): boolean {
  const skip = new Set<string>(COOL_SKIP_PROMO_FLAGS);
  for (const flag of thread.flags ?? []) {
    const token = normalizeTagToken(flag);
    if (token && skip.has(token)) return true;
  }
  return false;
}

/** High enough that cool gate (≤45) already rejects the bait card itself. */
export const BAIT_CONVERSATION_MIN_SCORE = 70;

/** True when triage marked this card as bait-ish (score and/or flags). */
export function isBaitConversationTagged(
  thread: Pick<ThreadCard, "baitScore" | "score" | "flags">,
): boolean {
  const bait = thread.baitScore ?? thread.score;
  if (
    typeof bait === "number" &&
    Number.isFinite(bait) &&
    bait >= BAIT_CONVERSATION_MIN_SCORE
  ) {
    return true;
  }
  for (const flag of thread.flags ?? []) {
    const token = normalizeTagToken(flag);
    if (
      token &&
      (BAIT_CONVERSATION_FLAGS as readonly string[]).includes(token)
    ) {
      return true;
    }
  }
  return false;
}

/** conversationId + id for every bait-tagged card in the batch. */
export function collectBaitConversationIds(
  threads: readonly Pick<
    ThreadCard,
    "id" | "conversationId" | "baitScore" | "score" | "flags"
  >[],
): Set<string> {
  const ids = new Set<string>();
  for (const t of threads) {
    if (!isBaitConversationTagged(t)) continue;
    if (t.id) ids.add(t.id);
    if (t.conversationId) ids.add(t.conversationId);
  }
  return ids;
}

/**
 * True for a reply that sits under a known bait conversation / parent.
 * Roots themselves are not dropped here (cool gate already rejects high bait).
 */
export function replyUnderBaitConversation(
  thread: Pick<
    ThreadCard,
    "isReply" | "inReplyToId" | "conversationId" | "id"
  >,
  baitIds: ReadonlySet<string>,
): boolean {
  if (!baitIds.size) return false;
  const isReply = thread.isReply === true || Boolean(thread.inReplyToId);
  if (!isReply) return false;
  if (thread.conversationId && baitIds.has(thread.conversationId)) return true;
  if (thread.inReplyToId && baitIds.has(thread.inReplyToId)) return true;
  return false;
}

/**
 * Text used for language detection — the card's own text only. OP/root text is
 * deliberately excluded: after hydrateReplyParents fills opText with the
 * conversation root, a non-preferred-language root would dominate the sample
 * and wrongly drop a preferred-language reply (and vice-versa).
 */
export function languageSampleText(thread: ThreadCard): string {
  return thread.text.trim();
}

/**
 * True when the thread confidently mismatches the preferred language.
 * Short / undetermined / detector errors → false (keep).
 */
export function isNonPreferredLanguage(
  thread: ThreadCard,
  preferred: PreferredLanguageCode = DEFAULT_PREFERRED_LANGUAGE,
): boolean {
  const sample = languageSampleText(thread);
  if (sample.length < LANGUAGE_MIN_CHARS) return false;
  try {
    const detected = franc(sample, {
      only: FRANC_ONLY,
      minLength: LANGUAGE_MIN_CHARS,
    });
    if (!detected || detected === "und") return false;
    return detected !== LANG1_TO_3[preferred];
  } catch {
    return false;
  }
}

/** Hard-drop confident non-preferred-language threads before length/triage. */
export function filterByLanguage(
  threads: ThreadCard[],
  preferred: PreferredLanguageCode = DEFAULT_PREFERRED_LANGUAGE,
): {
  threads: ThreadCard[];
  languageFilteredCount: number;
} {
  const kept: ThreadCard[] = [];
  let languageFilteredCount = 0;
  for (const thread of threads) {
    if (isNonPreferredLanguage(thread, preferred)) {
      languageFilteredCount += 1;
      continue;
    }
    kept.push(thread);
  }
  return { threads: kept, languageFilteredCount };
}

export function filterThreadsByLength(
  threads: ThreadCard[],
  maxChars: number = DEFAULT_MAX_THREAD_CHARS,
  opts: LengthFilterOptions = {},
): {
  threads: ThreadCard[];
  filteredCount: number;
  openerFilteredCount: number;
  articleFilteredCount: number;
} {
  const dropArticles = opts.dropArticles !== false;
  const articleIds = new Set<string>();
  if (dropArticles) {
    for (const id of opts.articleIds ?? []) articleIds.add(id);
    for (const id of collectArticleConversationIds(threads)) articleIds.add(id);
  }
  const kept: ThreadCard[] = [];
  let openerFilteredCount = 0;
  let articleFilteredCount = 0;
  let filteredCount = 0;

  for (const thread of threads) {
    if (dropArticles && thread.longform === "article") {
      filteredCount += 1;
      articleFilteredCount += 1;
      continue;
    }
    if (dropArticles && replyUnderArticle(thread, articleIds)) {
      filteredCount += 1;
      articleFilteredCount += 1;
      continue;
    }
    const reply = isReplyCard(thread);
    const opener =
      isThreadOpener(thread.text) ||
      (reply && isThreadOpener(thread.opText ?? ""));
    const oversized =
      isOversizedThread(thread.text, maxChars) ||
      (reply && parentCharCount(thread) > maxChars);
    if (opener || oversized) {
      filteredCount += 1;
      if (opener) openerFilteredCount += 1;
      continue;
    }
    kept.push(thread);
  }

  return {
    threads: kept,
    filteredCount,
    openerFilteredCount,
    articleFilteredCount,
  };
}
