/** API host from the browser hostname — no VITE secrets. */

export const PROD_API_ORIGIN = "https://api.xcopilot.dev";
export const LOCAL_API_ORIGIN = "http://127.0.0.1:8787";

export function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function apiBase(hostname?: string): string {
  const host =
    hostname ??
    (typeof window !== "undefined" ? window.location.hostname : "");
  if (isLocalHostname(host)) return LOCAL_API_ORIGIN;
  return PROD_API_ORIGIN;
}

export function apiUrl(path: string, hostname?: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase(hostname)}${p}`;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), { ...init, credentials: "include" });
}
