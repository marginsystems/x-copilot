/** Client-side Scout filter prefs (persisted in localStorage). */

export const SETTINGS_STORAGE_KEY = "x-copilot-settings";

/**
 * Marks storage written by a build that knows the current excluded-tags default
 * pair. Lets the legacy upgrade distinguish never-migrated storage from a list
 * a user explicitly saved (e.g. exactly `["supportive_encouragement"]`).
 */
export const SETTINGS_EXCLUDED_TAGS_MIGRATED_KEY =
  "x-copilot-settings-excluded-tags-migrated";

export const DEFAULT_MAX_THREAD_CHARS = 480;
export const MIN_MAX_THREAD_CHARS = 120;
export const MAX_MAX_THREAD_CHARS = 2000;

export const DEFAULT_TARGET_COOL_THREADS = 5;
export const MIN_TARGET_COOL_THREADS = 1;
export const MAX_TARGET_COOL_THREADS = 20;

/** ISO 639-1 codes supported in Settings / Scout language filter. Keep in sync with `PREFERRED_LANGUAGE_CODES` in server/src/threadFilters.ts. */
export const PREFERRED_LANGUAGES = ["en", "es", "fr", "de", "pt"] as const;
export type PreferredLanguage = (typeof PREFERRED_LANGUAGES)[number];
export const DEFAULT_PREFERRED_LANGUAGE: PreferredLanguage = "en";

/**
 * Post-triage Curated excludes (flags + normalized intent).
 * Keep in sync with `DEFAULT_EXCLUDED_TAGS` in server/src/threadFilters.ts.
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
 * Known excludeable tokens for Settings autocomplete / picker.
 * Keep in sync with `EXCLUDEABLE_TAG_VOCAB` in server/src/threadFilters.ts
 * and the flags list in TRIAGE_SYSTEM_PROMPT.
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
  "supportive_encouragement",
] as const;

export type AppSettings = {
  maxThreadChars: number;
  dropArticles: boolean;
  /** Hard-drop candidates whose text contains an em dash (U+2014), pre-triage. */
  dropEmDashes: boolean;
  targetCoolThreads: number;
  /** Never curate authors we've marked interacted (lifetime). */
  dedupeAccounts: boolean;
  /** Only keep Scout threads in this language (default English). */
  preferredLanguage: PreferredLanguage;
  /**
   * Drop cool/curated threads whose flags or intent match these tokens.
   * Empty = no tag excludes. Default includes supportive_encouragement + political.
   */
  excludedTags: string[];
};

export const DEFAULT_SETTINGS: AppSettings = {
  maxThreadChars: DEFAULT_MAX_THREAD_CHARS,
  dropArticles: true,
  dropEmDashes: true,
  targetCoolThreads: DEFAULT_TARGET_COOL_THREADS,
  dedupeAccounts: true,
  preferredLanguage: DEFAULT_PREFERRED_LANGUAGE,
  excludedTags: [...DEFAULT_EXCLUDED_TAGS],
};

export function clampMaxThreadChars(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) return DEFAULT_MAX_THREAD_CHARS;
  if (n < MIN_MAX_THREAD_CHARS) return MIN_MAX_THREAD_CHARS;
  if (n > MAX_MAX_THREAD_CHARS) return MAX_MAX_THREAD_CHARS;
  return n;
}

export function clampTargetCoolThreads(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) return DEFAULT_TARGET_COOL_THREADS;
  if (n < MIN_TARGET_COOL_THREADS) return MIN_TARGET_COOL_THREADS;
  if (n > MAX_TARGET_COOL_THREADS) return MAX_TARGET_COOL_THREADS;
  return n;
}

export function normalizePreferredLanguage(value: unknown): PreferredLanguage {
  if (typeof value !== "string") return DEFAULT_PREFERRED_LANGUAGE;
  const code = value.trim().toLowerCase();
  return (PREFERRED_LANGUAGES as readonly string[]).includes(code)
    ? (code as PreferredLanguage)
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

function sameTagList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((tag, i) => tag === b[i]);
}

/** Upgrade pre-political default storage to the current default pair. */
export function upgradeLegacyExcludedTags(tags: string[]): string[] {
  if (sameTagList(tags, LEGACY_DEFAULT_EXCLUDED_TAGS)) {
    return [...DEFAULT_EXCLUDED_TAGS];
  }
  return tags;
}

/**
 * Parse Settings text (comma and/or newline separated; whitespace stripped).
 * Examples: `tag1, tag2` · `tag1,\ntag2` · one token per line.
 */
export function parseExcludedTagsText(text: string): string[] {
  return normalizeExcludedTags(
    text
      .split(/[\n,]+/)
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

export function formatExcludedTagsText(tags: readonly string[]): string {
  return tags.join(", ");
}

/** True when any flag or normalized intent is in the exclude set. */
export function threadHasExcludedTag(
  thread: { flags?: string[]; intent?: string },
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

export function normalizeSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const obj = raw as Record<string, unknown>;
  const excludedTags =
    "excludedTags" in obj
      ? normalizeExcludedTags(obj.excludedTags)
      : [...DEFAULT_EXCLUDED_TAGS];
  return {
    maxThreadChars: clampMaxThreadChars(obj.maxThreadChars),
    dropArticles:
      typeof obj.dropArticles === "boolean"
        ? obj.dropArticles
        : DEFAULT_SETTINGS.dropArticles,
    dropEmDashes:
      typeof obj.dropEmDashes === "boolean"
        ? obj.dropEmDashes
        : DEFAULT_SETTINGS.dropEmDashes,
    targetCoolThreads: clampTargetCoolThreads(obj.targetCoolThreads),
    dedupeAccounts:
      typeof obj.dedupeAccounts === "boolean"
        ? obj.dedupeAccounts
        : DEFAULT_SETTINGS.dedupeAccounts,
    preferredLanguage: normalizePreferredLanguage(obj.preferredLanguage),
    excludedTags,
  };
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const settings = normalizeSettings(JSON.parse(raw) as unknown);
    if (localStorage.getItem(SETTINGS_EXCLUDED_TAGS_MIGRATED_KEY) === null) {
      settings.excludedTags = upgradeLegacyExcludedTags(settings.excludedTags);
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  const normalized = normalizeSettings(settings);
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  localStorage.setItem(SETTINGS_EXCLUDED_TAGS_MIGRATED_KEY, "1");
  return normalized;
}
