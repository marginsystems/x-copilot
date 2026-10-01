export type DeskTarget = { deskOrigin: string; apiBase: string };

export const DESK_TARGETS: readonly DeskTarget[] = [
  { deskOrigin: "https://xcopilot.dev", apiBase: "https://api.xcopilot.dev" },
  { deskOrigin: "https://www.xcopilot.dev", apiBase: "https://api.xcopilot.dev" },
  { deskOrigin: "http://localhost:5173", apiBase: "http://localhost:8787" },
  { deskOrigin: "http://127.0.0.1:5173", apiBase: "http://127.0.0.1:8787" },
];

export const DESK_MATCHES = DESK_TARGETS.map((target) => `${target.deskOrigin}/*`);

export const DEFAULT_DESK_ORIGIN = "https://xcopilot.dev";

export function apiBaseForDesk(deskOrigin: string): string | null {
  return DESK_TARGETS.find((target) => target.deskOrigin === deskOrigin)?.apiBase ?? null;
}
