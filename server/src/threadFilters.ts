/**
 * Deterministic post-search filters (length / thread openers / Articles / self-replies / links / language) before triage.
 */
import { franc } from "franc-min";
import { normalizeAuthorKey } from "./interactionStore.js";
import { textHasOutboundLink, type ThreadCard } from "./xSearch.js";

export const DEFAULT_MAX_THREAD_CHARS = 480;

/** ISO 639-1 allowlist. Keep in sync with `PREFERRED_LANGUAGES` in src/lib/settings.ts. */
export const PREFERRED_LANGUAGE_CODES = ["en", "es", "fr", "de", "pt"] as const;
export type PreferredLanguageCode = (typeof PREFERRED_LANGUAGE_CODES)[number];
export const DEFAULT_PREFERRED_LANGUAGE: PreferredLanguageCode = "en";

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
  /** When true (default), hard-drop X Articles marked on the card. */
  dropArticles?: boolean;
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

export function normalizePreferredLanguageCode(
  value: unknown,
): PreferredLanguageCode {
  if (typeof value !== "string") return DEFAULT_PREFERRED_LANGUAGE;
  const code = value.trim().toLowerCase();
  return (PREFERRED_LANGUAGE_CODES as readonly string[]).includes(code)
    ? (code as PreferredLanguageCode)
    : DEFAULT_PREFERRED_LANGUAGE;
}

/** Text used for language detection (post + optional OP). */
export function languageSampleText(thread: ThreadCard): string {
  const parts = [thread.text, thread.opText]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim());
  return parts.join("\n");
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
    const opener = isThreadOpener(thread.text);
    const oversized = isOversizedThread(thread.text, maxChars);
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
