/** Query-string codes from OAuth callbacks (`/?auth_error=`). */

export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  not_whitelisted: "Sign-in is open — try again, or use another Google or X account.",
  google_required: "Sign in with Google or X.",
  not_configured: "Auth is not configured on the API yet.",
  bad_state: "Login expired or was tampered with. Try again.",
  exchange_failed: "Could not finish login with the provider.",
  denied: "Login was cancelled.",
  no_email: "Google did not return an email address.",
  email_unverified: "Verify that Google account's email, then try again.",
  already_linked: "That X account is already linked to someone else.",
  user_missing: "That account no longer exists. Try signing in again.",
};

export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return AUTH_ERROR_MESSAGES[code] ?? `Sign-in failed (${code}).`;
}
