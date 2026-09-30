export type LeaderboardCounts = { replies: number; quotes: number };

export type BarShares = { replyPct: number; quotePct: number };

export type GhostDisc = { x: number; y: number; r: number };

export const GHOST_RING_LAYERS: ReadonlyArray<{ count: number; radius: number; disc: number }> = [
  { count: 6, radius: 17, disc: 5.5 },
  { count: 12, radius: 31, disc: 4.5 },
  { count: 18, radius: 43, disc: 3.5 },
];

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

export function formatMemberCounts(member: LeaderboardCounts): string {
  const replies = whole(member.replies);
  const quotes = whole(member.quotes);
  const parts: string[] = [];
  if (replies > 0) parts.push(String(replies));
  if (quotes > 0) parts.push(`${quotes}q`);
  return parts.join(" · ");
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

export function ghostRing(): GhostDisc[] {
  return GHOST_RING_LAYERS.flatMap((layer, index) =>
    Array.from({ length: layer.count }, (_, i) => {
      const deg = (i / layer.count) * 360 + (index % 2 === 0 ? 0 : 180 / layer.count) - 90;
      const rad = (deg * Math.PI) / 180;
      return {
        x: Math.round((50 + layer.radius * Math.cos(rad)) * 100) / 100,
        y: Math.round((62.5 + layer.radius * Math.sin(rad)) * 100) / 100,
        r: layer.disc,
      };
    }),
  );
}

export function emptyCircleLine(people: number, needed: number): string {
  return `Reply to more people to draw your circle (${whole(people)} of ${whole(needed)}).`;
}
