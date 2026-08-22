import type { ThreadCard } from "./types";

/** Keep in sync with server/src/interactionStore.ts parseStatusIdFromUrl. */
export function parseStatusIdFromUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (
      host !== "x.com" &&
      host !== "twitter.com" &&
      host !== "mobile.twitter.com"
    ) {
      return null;
    }
    const m = u.pathname.match(/\/status(?:es)?\/(\d+)/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export function normalizeAuthorKey(author: string): string {
  return author.trim().replace(/^@+/, "").toLowerCase();
}

export function threadHasExcludedAuthor(
  thread: ThreadCard,
  excludedAccounts: readonly string[],
): boolean {
  if (!excludedAccounts.length) return false;
  const key = normalizeAuthorKey(thread.author);
  if (!key) return false;
  const excluded = new Set(excludedAccounts.map((h) => normalizeAuthorKey(h)));
  return excluded.has(key);
}

export function baitRisk(thread: ThreadCard): number | null {
  const value = thread.baitScore ?? thread.score;
  return typeof value === "number" ? value : null;
}

export function baitClass(bait: number | null): string {
  if (bait === null) return "bait";
  if (bait >= 65) return "bait high";
  if (bait >= 35) return "bait mid";
  return "bait low";
}

export function appendThreadsById(
  prev: ThreadCard[],
  next: ThreadCard[] | undefined,
): ThreadCard[] {
  if (!next?.length) return prev;
  const seen = new Set(prev.map((t) => t.id));
  const out = [...prev];
  for (const t of next) {
    if (!t.id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

export function coolProgressLabel(
  coolCount: number | undefined,
  targetCool: number | undefined,
  fallbackTarget: number,
): string {
  const cool = typeof coolCount === "number" ? coolCount : 0;
  const target =
    typeof targetCool === "number" ? targetCool : fallbackTarget;
  return `Cool ${cool}/${target}`;
}

export function scoutProgressPrefix(ev: {
  message?: string;
  candidates?: number;
  bucketSize?: number;
  coolCount?: number;
  targetCool?: number;
}): string | null {
  if (
    typeof ev.candidates === "number" &&
    typeof ev.bucketSize === "number" &&
    (ev.coolCount ?? 0) === 0
  ) {
    return `Cand. ${ev.candidates}/${ev.bucketSize}`;
  }
  if (typeof ev.coolCount === "number" && ev.coolCount > 0) {
    return typeof ev.targetCool === "number"
      ? `Cool ${ev.coolCount}/${ev.targetCool}`
      : `Cool ${ev.coolCount}`;
  }
  return null;
}
