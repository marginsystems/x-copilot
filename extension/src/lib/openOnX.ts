export type TabLike = { id?: number; url?: string; active?: boolean };

export type OpenPlan =
  | { kind: "update"; tabId: number; activate: boolean }
  | { kind: "create" };

export function isXUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "x.com" || host === "www.x.com" || host === "twitter.com";
  } catch {
    return false;
  }
}

export function planOpenOnX(tabs: readonly TabLike[]): OpenPlan {
  const active = tabs.find((tab) => tab.active && tab.id !== undefined && isXUrl(tab.url));
  if (active?.id !== undefined) return { kind: "update", tabId: active.id, activate: false };
  const other = tabs.find((tab) => tab.id !== undefined && isXUrl(tab.url));
  if (other?.id !== undefined) return { kind: "update", tabId: other.id, activate: true };
  return { kind: "create" };
}
