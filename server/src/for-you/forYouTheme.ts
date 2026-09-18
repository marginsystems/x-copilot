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

function targetKeys(row: ForYouThemeCard): Set<string> {
  const keys = new Set<string>();
  const id = row.targetId?.trim();
  const url = row.targetUrl?.trim();
  if (id) keys.add(id);
  if (url) {
    keys.add(url);
    const statusId = url.match(/\/status\/([^/?#]+)/)?.[1];
    if (statusId) keys.add(statusId);
  }
  return keys;
}

function postThemeOverlap(a: ForYouThemeCard, b: ForYouThemeCard): boolean {
  const leftWhy = themeTokens(a.why);
  const rightWhy = themeTokens(b.why);
  const leftDraft = themeTokens(a.draft ?? "");
  const rightDraft = themeTokens(b.draft ?? "");
  if (leftWhy.size === 0 || rightWhy.size === 0) return false;
  let whyHit = 0;
  for (const token of leftWhy) {
    if (rightWhy.has(token)) whyHit += 1;
  }
  let draftHit = 0;
  for (const token of leftDraft) {
    if (rightDraft.has(token)) draftHit += 1;
  }
  const left = new Set([...leftWhy, ...leftDraft]);
  const right = new Set([...rightWhy, ...rightDraft]);
  let hit = 0;
  for (const token of left) {
    if (right.has(token)) hit += 1;
  }
  const denom = Math.min(left.size, right.size);
  return hit >= 2 && hit / denom >= 0.4 && (whyHit >= 2 || draftHit >= 2);
}

/** Same target, or the same original thesis. Skip one, bury the remixes. */
export function sameSuggestionTheme(
  a: ForYouThemeCard,
  b: ForYouThemeCard,
): boolean {
  const aTargets = targetKeys(a);
  const bTargets = targetKeys(b);
  if (aTargets.size > 0 && bTargets.size > 0) {
    return a.kind === b.kind && [...aTargets].some((key) => bTargets.has(key));
  }
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
