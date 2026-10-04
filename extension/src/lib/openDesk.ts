export type DeskTabLike = { id?: number; url?: string; windowId?: number };

export type OpenDeskPlan =
  | { kind: "create"; url: string }
  | { kind: "focus"; tabId: number; windowId: number | null; url: string | null };

function deskTabOrigin(tab: DeskTabLike, deskOrigins: readonly string[]): string | null {
  if (tab.id === undefined || !tab.url) return null;
  try {
    const { origin } = new URL(tab.url);
    return deskOrigins.includes(origin) ? origin : null;
  } catch {
    return null;
  }
}

function samePath(url: string, path: string): boolean {
  const trim = (value: string) => (value.length > 1 ? value.replace(/\/+$/, "") : value);
  return trim(new URL(url).pathname) === trim(path);
}

export function planOpenDesk(
  tabs: readonly DeskTabLike[],
  path: string,
  deskOrigins: readonly string[],
  fallbackOrigin: string,
): OpenDeskPlan {
  const deskTabs = tabs.flatMap((tab) => {
    const origin = deskTabOrigin(tab, deskOrigins);
    return origin && tab.id !== undefined && tab.url ? [{ id: tab.id, url: tab.url, windowId: tab.windowId ?? null, origin }] : [];
  });
  const onPage = deskTabs.find((tab) => samePath(tab.url, path));
  if (onPage) return { kind: "focus", tabId: onPage.id, windowId: onPage.windowId, url: null };
  const first = deskTabs[0];
  if (first) return { kind: "focus", tabId: first.id, windowId: first.windowId, url: `${first.origin}${path}` };
  return { kind: "create", url: `${fallbackOrigin}${path}` };
}
