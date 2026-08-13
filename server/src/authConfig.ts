/**
 * Auth env: email/handle allowlists, OAuth client settings, frontend return URL.
 */

export function parseCsvList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseEmailWhitelist(
  raw: string | undefined = process.env.AUTH_EMAIL_WHITELIST,
): string[] {
  return parseCsvList(raw).map((e) => e.toLowerCase());
}

export function isEmailWhitelisted(
  email: string | null | undefined,
  whitelist: string[] = parseEmailWhitelist(),
): boolean {
  if (!email) return false;
  if (whitelist.length === 0) return false;
  return whitelist.includes(email.trim().toLowerCase());
}

export function parseXHandleWhitelist(
  raw: string | undefined = process.env.AUTH_X_HANDLE_WHITELIST,
): string[] {
  return parseCsvList(raw).map((h) => h.replace(/^@/, "").toLowerCase());
}

export function isXHandleWhitelisted(
  handle: string | null | undefined,
  whitelist: string[] = parseXHandleWhitelist(),
): boolean {
  if (!handle) return false;
  if (whitelist.length === 0) return false;
  return whitelist.includes(handle.replace(/^@/, "").trim().toLowerCase());
}

export function googleClientConfig(env: NodeJS.ProcessEnv = process.env): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) return null;
  const port = env.PORT?.trim() || "8787";
  const redirectUri =
    env.GOOGLE_REDIRECT_URI?.trim() ||
    `http://127.0.0.1:${port}/api/auth/google/callback`;
  return { clientId, clientSecret, redirectUri };
}

export function frontendOrigin(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env.FRONTEND_ORIGIN?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const allowed = parseCsvList(env.ALLOWED_ORIGINS);
  const prod = allowed.find((o) => o.startsWith("https://"));
  if (prod) return prod.replace(/\/$/, "");
  return "http://127.0.0.1:5173";
}

export function authErrorRedirect(code: string, env?: NodeJS.ProcessEnv): string {
  const base = frontendOrigin(env);
  return `${base}/?auth_error=${encodeURIComponent(code)}`;
}

export function authSuccessRedirect(env?: NodeJS.ProcessEnv): string {
  return `${frontendOrigin(env)}/?auth=ok`;
}
