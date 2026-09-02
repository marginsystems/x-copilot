/** Skip / not-interested veto. Daily and extra passes must not rewrite these. */
export const SKIPPED_THEME_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export type ForYouThemeCard = {
  kind: string;
  why: string;
  draft?: string | null;
  targetId?: string | null;
  targetUrl?: string | null;
};

const THEME_STOP = new Set([
  "about",
  "after",
  "been",
  "best",
  "double",
  "down",
  "from",
  "have",
  "into",
  "original",
  "post",
  "quote",
  "reply",
  "repost",
  "shape",
  "take",
  "than",
  "that",
  "their",
  "them",
  "then",
  "this",
  "view",
  "views",
  "with",
  "your",
  "yours",
]);

export function themeTokens(text: string): Set<string> {
  const out = new Set<string>();
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  for (const word of cleaned.split(/\s+/)) {
    if (word.length >= 5 && !THEME_STOP.has(word)) out.add(word);
  }
  return out;
}

function targetKey(row: ForYouThemeCard): string {
  const id = row.targetId?.trim();
  if (id) return id;
  return row.targetUrl?.trim() ?? "";
}

function postThemeOverlap(a: ForYouThemeCard, b: ForYouThemeCard): boolean {
  const left = themeTokens(`${a.why} ${a.draft ?? ""}`);
  const right = themeTokens(`${b.why} ${b.draft ?? ""}`);
  if (left.size === 0 || right.size === 0) return false;
  let hit = 0;
  for (const token of left) {
    if (right.has(token)) hit += 1;
  }
  const denom = Math.min(left.size, right.size);
  return hit >= 2 && hit / denom >= 0.4;
}

/** Same target, or the same original thesis. Skip one, bury the remixes. */
export function sameSuggestionTheme(
  a: ForYouThemeCard,
  b: ForYouThemeCard,
): boolean {
  const aTarget = targetKey(a);
  const bTarget = targetKey(b);
  if (aTarget && bTarget) return a.kind === b.kind && aTarget === bTarget;
  if (a.kind !== "post" || b.kind !== "post") return false;
  return postThemeOverlap(a, b);
}

export function matchesSkippedTheme(
  row: ForYouThemeCard,
  skipped: readonly ForYouThemeCard[],
): boolean {
  return skipped.some((item) => sameSuggestionTheme(row, item));
}

export function withoutSkippedThemes<T extends ForYouThemeCard>(
  rows: readonly T[],
  skipped: readonly ForYouThemeCard[],
): T[] {
  if (skipped.length === 0) return [...rows];
  return rows.filter((row) => !matchesSkippedTheme(row, skipped));
}
