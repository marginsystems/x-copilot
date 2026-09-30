import type { Interaction } from "../desk/interactionStore.js";
import { normalizeAuthorKey } from "../desk/interactionCooldown.js";
import type { CircleLink } from "./circleStore.js";
import type { XProfile } from "./xProfiles.js";

export const CIRCLE_LIMIT = 64;

export type CircleMember = {
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  replies: number;
  quotes: number;
  score: number;
  lastAt: string;
};

export type CircleTotals = { replies: number; quotes: number; people: number };

export type Circle = { members: CircleMember[]; totals: CircleTotals };

type Tally = {
  key: string;
  rawHandle: string;
  replyPosts: Set<string>;
  quotePosts: Set<string>;
  lastMs: number;
  lastAt: string;
};

export function isCircleAuthorKey(key: string, selfKey: string): boolean {
  if (!key || key === selfKey) return false;
  if (key === "unknown") return false;
  return !/^\d+$/.test(key);
}

export function buildCircle(input: {
  selfHandle: string | null;
  history: readonly Interaction[];
  links: readonly CircleLink[];
  profiles: readonly XProfile[];
  limit?: number;
}): Circle {
  const selfKey = input.selfHandle ? normalizeAuthorKey(input.selfHandle) : "";
  const profiles = new Map(input.profiles.map((p) => [normalizeAuthorKey(p.authorKey), p]));
  const tallies = new Map<string, Tally>();
  const quotePostIds = new Set(
    input.links.filter((link) => link.kind === "quote").map((link) => link.postId),
  );
  const replyLinkAuthors = new Map<string, string>();
  for (const link of input.links) {
    if (link.kind !== "reply") continue;
    const key = normalizeAuthorKey(link.authorKey);
    if (isCircleAuthorKey(key, selfKey)) replyLinkAuthors.set(link.postId, key);
  }
  const historyReplyIds = new Set(
    input.history.flatMap((row) => {
      const key = normalizeAuthorKey(row.author || row.authorKey);
      return row.replyId && isCircleAuthorKey(key, selfKey) &&
          (!replyLinkAuthors.has(row.replyId) || replyLinkAuthors.get(row.replyId) === key)
        ? [row.replyId]
        : [];
    }),
  );

  const tally = (rawAuthor: string, at: string): Tally | null => {
    const key = normalizeAuthorKey(rawAuthor);
    if (!isCircleAuthorKey(key, selfKey)) return null;
    let entry = tallies.get(key);
    if (!entry) {
      entry = {
        key,
        rawHandle: rawAuthor.trim().replace(/^@+/, ""),
        replyPosts: new Set(),
        quotePosts: new Set(),
        lastMs: Number.NEGATIVE_INFINITY,
        lastAt: "",
      };
      tallies.set(key, entry);
    }
    const handle = rawAuthor.trim().replace(/^@+/, "");
    if (entry.rawHandle === key && handle !== key) entry.rawHandle = handle;
    const ms = Date.parse(at);
    if (Number.isFinite(ms) && ms > entry.lastMs) {
      entry.lastMs = ms;
      entry.lastAt = new Date(ms).toISOString();
    }
    return entry;
  };

  for (const row of input.history) {
    const postId = row.replyId ?? `thread:${row.threadId}`;
    if (quotePostIds.has(postId)) continue;
    const key = normalizeAuthorKey(row.author || row.authorKey);
    if (
      row.replyId &&
      replyLinkAuthors.has(row.replyId) &&
      replyLinkAuthors.get(row.replyId) !== key
    ) {
      continue;
    }
    const entry = tally(row.author || row.authorKey, row.postedAt ?? row.at);
    entry?.replyPosts.add(postId);
  }

  for (const link of input.links) {
    if (link.kind === "reply" && historyReplyIds.has(link.postId)) continue;
    const entry = tally(link.authorKey, link.at);
    if (!entry) continue;
    if (link.kind === "quote") entry.quotePosts.add(link.postId);
    else entry.replyPosts.add(link.postId);
  }

  const all = [...tallies.values()]
    .filter((t) => t.replyPosts.size + t.quotePosts.size > 0)
    .map((t) => {
      const profile = profiles.get(t.key);
      const replies = t.replyPosts.size;
      const quotes = t.quotePosts.size;
      return {
        member: {
          handle: profile?.handle ?? t.rawHandle,
          name: profile?.name ?? null,
          avatarUrl: profile?.avatarUrl ?? null,
          replies,
          quotes,
          score: replies + 2 * quotes,
          lastAt: t.lastAt,
        },
        lastMs: t.lastMs,
      };
    })
    .sort((a, b) => {
      if (b.member.score !== a.member.score) return b.member.score - a.member.score;
      if (b.lastMs !== a.lastMs) return b.lastMs - a.lastMs;
      const ah = a.member.handle.toLowerCase();
      const bh = b.member.handle.toLowerCase();
      return ah < bh ? -1 : ah > bh ? 1 : 0;
    });

  const totals: CircleTotals = {
    replies: all.reduce((sum, { member }) => sum + member.replies, 0),
    quotes: all.reduce((sum, { member }) => sum + member.quotes, 0),
    people: all.length,
  };
  const limit = Math.max(0, Math.floor(input.limit ?? CIRCLE_LIMIT));
  return { members: all.slice(0, limit).map(({ member }) => member), totals };
}
