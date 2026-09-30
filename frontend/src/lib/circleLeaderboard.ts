export type LeaderboardCounts = { replies: number; quotes: number };

export type BarShares = { replyPct: number; quotePct: number };

export const GHOST_SCORES: readonly number[] = [18, 15, 13, 11, 9, 8, 7, 6, 5, 4, 3, 3, 2, 2];

function whole(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function memberScore(member: LeaderboardCounts): number {
  return whole(member.replies) + 2 * whole(member.quotes);
}

export function barShares(member: LeaderboardCounts, topScore: number): BarShares {
  const top = whole(topScore);
  if (top === 0) return { replyPct: 0, quotePct: 0 };
  const replyPct = Math.min(100, (whole(member.replies) / top) * 100);
  const quotePct = Math.min(100 - replyPct, ((2 * whole(member.quotes)) / top) * 100);
  return { replyPct, quotePct };
}

export function formatReplies(member: LeaderboardCounts): string {
  const replies = whole(member.replies);
  return replies > 0 ? String(replies) : "";
}

export function formatQuotes(member: LeaderboardCounts): string {
  const quotes = whole(member.quotes);
  return quotes > 0 ? `${quotes}q` : "";
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function circleStatLine(totals: {
  people: number;
  replies: number;
  quotes: number;
}): string {
  const parts: string[] = [];
  const people = whole(totals.people);
  const replies = whole(totals.replies);
  const quotes = whole(totals.quotes);
  if (people > 0) parts.push(plural(people, "person", "people"));
  if (replies > 0) parts.push(plural(replies, "reply", "replies"));
  if (quotes > 0) parts.push(plural(quotes, "quote", "quotes"));
  return parts.join(" · ");
}

export function memberInitial(handle: string, name: string | null): string {
  const source = (name?.trim() || handle).replace(/^@+/, "");
  const first = Array.from(source)[0];
  return first ? first.toUpperCase() : "?";
}

export function memberDetail(member: LeaderboardCounts): string {
  const replies = whole(member.replies);
  const quotes = whole(member.quotes);
  const parts: string[] = [];
  if (replies > 0) parts.push(plural(replies, "reply", "replies"));
  if (quotes > 0) parts.push(plural(quotes, "quote", "quotes"));
  return parts.join(" · ");
}

export function bubbleMapLabel(
  members: readonly (LeaderboardCounts & { handle: string })[],
  people: number,
): string {
  const closest = members
    .slice(0, 3)
    .map((m) => `@${m.handle} (${memberDetail(m) || "no activity"})`)
    .join(", ");
  return `Bubble map of your X Circle, ${plural(whole(people), "person", "people")}. Closest: ${closest}.`;
}

export function emptyCircleLine(people: number, needed: number): string {
  return `Reply to more people to draw your circle (${whole(people)} of ${whole(needed)}).`;
}
