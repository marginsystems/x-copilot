/** Client-side Scout filter prefs (persisted in localStorage). */

export const SETTINGS_STORAGE_KEY = "x-copilot-settings";

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

export type AppSettings = {
  maxThreadChars: number;
  dropArticles: boolean;
  targetCoolThreads: number;
  /** Never curate authors we've marked interacted (lifetime). */
  dedupeAccounts: boolean;
  /** Only keep Scout threads in this language (default English). */
  preferredLanguage: PreferredLanguage;
};

export const DEFAULT_SETTINGS: AppSettings = {
  maxThreadChars: DEFAULT_MAX_THREAD_CHARS,
  dropArticles: true,
  targetCoolThreads: DEFAULT_TARGET_COOL_THREADS,
  dedupeAccounts: true,
  preferredLanguage: DEFAULT_PREFERRED_LANGUAGE,
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

export function normalizeSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const obj = raw as Record<string, unknown>;
  return {
    maxThreadChars: clampMaxThreadChars(obj.maxThreadChars),
    dropArticles:
      typeof obj.dropArticles === "boolean"
        ? obj.dropArticles
        : DEFAULT_SETTINGS.dropArticles,
    targetCoolThreads: clampTargetCoolThreads(obj.targetCoolThreads),
    dedupeAccounts:
      typeof obj.dedupeAccounts === "boolean"
        ? obj.dedupeAccounts
        : DEFAULT_SETTINGS.dedupeAccounts,
    preferredLanguage: normalizePreferredLanguage(obj.preferredLanguage),
  };
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  const normalized = normalizeSettings(settings);
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}
