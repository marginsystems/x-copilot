/**
 * Auth env: OAuth client settings and frontend return URL.
 * Signup is open — Free is the default plan. ADMIN_EMAILS stays operator-only.
 */

export function parseCsvList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function googleClientConfig(env: NodeJS.ProcessEnv = process.env): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) return null;
  const redirectUri =
    env.GOOGLE_REDIRECT_URI?.trim() ||
    `http://127.0.0.1:${env.PORT?.trim() || "8787"}/api/auth/google/callback`;
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
  return `${frontendOrigin(env)}/dashboard?auth=ok`;
}
