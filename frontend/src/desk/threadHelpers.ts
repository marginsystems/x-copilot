import type { ThreadCard } from "./types";

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
