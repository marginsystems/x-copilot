/** API host from the browser hostname — no VITE secrets. */

export const PROD_API_ORIGIN = "https://api.xcopilot.dev";
export const LOCAL_API_ORIGIN = "http://127.0.0.1:8787";
const LOCAL_API_PORT = "8787";

export function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function apiBase(hostname?: string): string {
  const host =
    hostname ??
    (typeof window !== "undefined" ? window.location.hostname : "");
  if (isLocalHostname(host)) return `http://${host}:${LOCAL_API_PORT}`;
  return PROD_API_ORIGIN;
}

export function apiUrl(path: string, hostname?: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase(hostname)}${p}`;
}

export class ProvisionalSessionError extends Error {
  constructor() {
    super("Writes are paused until the session is verified.");
    this.name = "ProvisionalSessionError";
  }
}

let mutationGate: (() => boolean) | null = null;

export function setMutationGate(gate: (() => boolean) | null): void {
  mutationGate = gate;
}

function isReadMethod(init?: RequestInit): boolean {
  const method = (init?.method ?? "GET").toUpperCase();
  return method === "GET" || method === "HEAD";
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!isReadMethod(init) && mutationGate && !mutationGate()) {
    return Promise.reject(new ProvisionalSessionError());
  }
  return fetch(apiUrl(path), { ...init, credentials: "include" });
}
