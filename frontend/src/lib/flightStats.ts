export function formatThousands(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const whole = Math.max(0, Math.round(n));
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function levelXpRemaining(opts: { xpIntoLevel: number; xpToNext: number }): number {
  const span = Number.isFinite(opts.xpToNext) ? Math.max(1, opts.xpToNext) : 1;
  const into = Number.isFinite(opts.xpIntoLevel) ? Math.max(0, opts.xpIntoLevel) : 0;
  return Math.max(0, span - into);
}

export function levelXpLabel(opts: {
  level: number;
  xpIntoLevel: number;
  xpToNext: number;
}): string {
  const level = Number.isFinite(opts.level) ? Math.max(1, Math.floor(opts.level)) : 1;
  return `${levelXpRemaining(opts)} XP to Lv ${level + 1}`;
}

export function levelBarPercent(opts: { xpIntoLevel: number; xpToNext: number }): number {
  const span = Number.isFinite(opts.xpToNext) ? Math.max(1, opts.xpToNext) : 1;
  const into = Number.isFinite(opts.xpIntoLevel) ? Math.max(0, opts.xpIntoLevel) : 0;
  return Math.min(100, (into / span) * 100);
}

export function postsViewsLabel(posts: number, views: number): string {
  const p = formatThousands(posts);
  return `${p} ${p === "1" ? "post" : "posts"} · ${formatThousands(views)} views`;
}
