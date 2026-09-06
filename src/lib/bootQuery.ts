import { authErrorMessage } from "./authErrors";

/** One-shot query flags the OAuth and Stripe callbacks land on the app with. */
export type BootQuery = {
  /** Human message for `?auth_error=`, or null. */
  authError: string | null;
  /** `?auth=ok` — a callback just signed the user in. */
  authOk: boolean;
  /** `?checkout=success|cancel` raw value, or null. */
  checkout: string | null;
  /** `?session_id=` from a Stripe success redirect, or null. */
  sessionId: string | null;
  /** URL to `replaceState` to once the flags are consumed, or null when nothing to strip. */
  cleanUrl: string | null;
};

const BOOT_PARAMS = ["auth_error", "auth", "checkout", "session_id"] as const;

export function readBootQuery(loc: {
  search: string;
  pathname: string;
  hash: string;
}): BootQuery {
  const params = new URLSearchParams(loc.search);
  const authError = authErrorMessage(params.get("auth_error"));
  const authOk = params.get("auth") === "ok";
  const checkout = params.get("checkout");
  const sessionId = params.get("session_id");
  let cleanUrl: string | null = null;
  if (BOOT_PARAMS.some((key) => params.has(key))) {
    for (const key of BOOT_PARAMS) params.delete(key);
    const path = checkout ? "/usage" : loc.pathname;
    cleanUrl = `${path}${params.toString() ? `?${params}` : ""}${loc.hash}`;
  }
  return { authError, authOk, checkout, sessionId, cleanUrl };
}
