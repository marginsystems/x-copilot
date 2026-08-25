/**
 * Public /changelog. Newest first. The git log is the draft — curate
 * user-facing ships, not every commit. Each row is a launch note.
 */

export type ChangelogEntry = {
  date: string;
  title: string;
  body: string;
  href?: string;
};

export type ChangelogDay = {
  date: string;
  items: ChangelogEntry[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-08-25",
    title: "Share your flight path",
    body: "A quiet icon next to Flight path downloads a PNG of this week's marks, altitude, streak, and level. Watermarked xcopilot.dev. Replies stay unstamped.",
    href: "https://github.com/marginsystems/x-copilot/pull/483",
  },
  {
    date: "2026-08-25",
    title: "Share your Voice card",
    body: "Download a PNG of what Voice learned from your public posts. Watermarked xcopilot.dev. Replies stay unstamped.",
    href: "https://github.com/marginsystems/x-copilot/pull/477",
  },
  {
    date: "2026-08-24",
    title: "Opt-in Approach email",
    body: "A daily digest of your Approach desk, only if you turn it on. Default off. Verified Google email. Unsubscribe in one click.",
    href: "https://github.com/marginsystems/x-copilot/pull/473",
  },
  {
    date: "2026-08-24",
    title: "Suggest unlocks before 100 posts",
    body: "A tone-only starter card so Suggest is not a cliff. The full card still waits for 100 public posts.",
    href: "https://github.com/marginsystems/x-copilot/pull/471",
  },
  {
    date: "2026-08-24",
    title: "Approach, not For You",
    body: "The curated tab is Approach. Empty state shows how many posts are tracked and when the first digest lands.",
    href: "https://github.com/marginsystems/x-copilot/pull/467",
  },
  {
    date: "2026-08-24",
    title: "Generate an agenda on the landing page",
    body: "Answer three questions, watch DeepSeek write three agendas, then sign in to run the one you pick.",
    href: "https://github.com/marginsystems/x-copilot/pull/465",
  },
  {
    date: "2026-08-24",
    title: "Failed takeoffs no longer burn the day",
    body: "A takeoff refunds when the run errors, aborts with no cools, or lands zero threads. Cap hits name the next plan.",
    href: "https://github.com/marginsystems/x-copilot/pull/463",
  },
  {
    date: "2026-08-24",
    title: "Approach prefers winners",
    body: "The digest will not revive a low-view post just to fill the page.",
    href: "https://github.com/marginsystems/x-copilot/pull/461",
  },
  {
    date: "2026-08-24",
    title: "Questions before the X wall",
    body: "Onboarding asks what you hunt for, then asks you to link X. The desk is still X-gated.",
    href: "https://github.com/marginsystems/x-copilot/pull/457",
  },
  {
    date: "2026-08-24",
    title: "Desk agenda actually saves",
    body: "Edits persist. Take off no longer clobbers what you typed.",
    href: "https://github.com/marginsystems/x-copilot/pull/451",
  },
  {
    date: "2026-08-24",
    title: "Public pricing",
    body: "Free, Pulse, Radar, and Horizon on /pricing. No card for Free.",
    href: "https://github.com/marginsystems/x-copilot/pull/453",
  },
  {
    date: "2026-08-24",
    title: "Next goal on Flight path",
    body: "The next achievement is visible. Toasts fire on a real unlock, not on hydrate.",
    href: "https://github.com/marginsystems/x-copilot/pull/449",
  },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isChangelogDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function formatChangelogDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).toLocaleDateString(
    "en-US",
    { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" },
  );
}

export function changelogByDate(
  entries: readonly ChangelogEntry[] = CHANGELOG,
): ChangelogDay[] {
  const days: ChangelogDay[] = [];
  for (const entry of entries) {
    const last = days[days.length - 1];
    if (last && last.date === entry.date) last.items.push(entry);
    else days.push({ date: entry.date, items: [entry] });
  }
  return days;
}
