export type DeskTarget = { deskOrigin: string; apiBase: string };

const STORE_TARGETS: readonly DeskTarget[] = [
  { deskOrigin: "https://xcopilot.dev", apiBase: "https://api.xcopilot.dev" },
  { deskOrigin: "https://www.xcopilot.dev", apiBase: "https://api.xcopilot.dev" },
];

const LOCAL_TARGETS: readonly DeskTarget[] = [
  { deskOrigin: "http://localhost:5173", apiBase: "http://localhost:8787" },
  { deskOrigin: "http://127.0.0.1:5173", apiBase: "http://127.0.0.1:8787" },
];

export function deskTargets(mode: string | undefined): readonly DeskTarget[] {
  return mode === "development" ? [...STORE_TARGETS, ...LOCAL_TARGETS] : STORE_TARGETS;
}

export function deskMatches(targets: readonly DeskTarget[]): string[] {
  return targets.map((target) => {
    const url = new URL(target.deskOrigin);
    return `${url.protocol}//${url.hostname}/*`;
  });
}

export const DESK_TARGETS = deskTargets(import.meta.env.MODE);

export const DESK_MATCHES = deskMatches(DESK_TARGETS);

export const DEFAULT_DESK_ORIGIN = "https://xcopilot.dev";

export function apiBaseForDesk(deskOrigin: string): string | null {
  return DESK_TARGETS.find((target) => target.deskOrigin === deskOrigin)?.apiBase ?? null;
}
