/**
 * Google OAuth (openid email profile) — server-side code exchange.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createSession, upsertOauthUser, type AuthUser } from "./authStore.js";
import {
  authErrorRedirect,
  authSuccessRedirect,
  googleClientConfig,
  isEmailWhitelisted,
} from "./authConfig.js";
import { corsHeaders } from "./cors.js";
import {
  appendSetCookie,
  newOauthState,
  oauthStateClearCookie,
  oauthStateSetCookie,
  requestCookies,
  OAUTH_STATE_COOKIE,
  sessionSetCookie,
} from "./sessionCookie.js";

export type GoogleProfile = {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
};

export function buildGoogleAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", opts.state);
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("prompt", "select_account");
  return u.toString();
}

export async function exchangeGoogleCode(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; profile: GoogleProfile }
  | { ok: false; error: string; status: number }
> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
    grant_type: "authorization_code",
  });
  let tokenRes: Response;
  try {
    tokenRes = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : "token_fetch_failed",
    };
  }
  if (!tokenRes.ok) {
    return { ok: false, status: 502, error: "token_exchange_failed" };
  }
  let tokenJson: { access_token?: string };
  try {
    tokenJson = (await tokenRes.json()) as { access_token?: string };
  } catch {
    return { ok: false, status: 502, error: "token_exchange_failed" };
  }
  const accessToken = tokenJson.access_token?.trim();
  if (!accessToken) {
    return { ok: false, status: 502, error: "missing_access_token" };
  }

  let infoRes: Response;
  try {
    infoRes = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : "userinfo_fetch_failed",
    };
  }
  if (!infoRes.ok) {
    return { ok: false, status: 502, error: "userinfo_failed" };
  }
  let info: {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  try {
    info = (await infoRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
  } catch {
    return { ok: false, status: 502, error: "userinfo_failed" };
  }
  if (!info.sub) {
    return { ok: false, status: 502, error: "missing_sub" };
  }
  return {
    ok: true,
    profile: {
      sub: info.sub,
      email: info.email?.trim().toLowerCase() || null,
      emailVerified: Boolean(info.email_verified),
      name: info.name?.trim() || null,
      picture: info.picture?.trim() || null,
    },
  };
}

export function completeGoogleLogin(profile: GoogleProfile):
  | { ok: true; user: AuthUser; token: string; expiresAt: string }
  | { ok: false; error: string } {
  if (!profile.email) {
    return { ok: false, error: "no_email" };
  }
  if (!profile.emailVerified) {
    return { ok: false, error: "email_unverified" };
  }
  if (!isEmailWhitelisted(profile.email)) {
    return { ok: false, error: "not_whitelisted" };
  }
  const user = upsertOauthUser({
    provider: "google",
    providerUserId: profile.sub,
    email: profile.email,
    emailVerified: true,
    displayName: profile.name,
    avatarUrl: profile.picture,
  });
  const session = createSession(user.id);
  return { ok: true, user, token: session.token, expiresAt: session.expiresAt };
}

function redirect(
  req: IncomingMessage,
  res: ServerResponse,
  location: string,
  extraCookies: string[] = [],
): void {
  const headers: Record<string, string | string[]> = {
    Location: location,
    ...corsHeaders(req),
  };
  for (const c of extraCookies) {
    appendSetCookie(headers, c);
  }
  res.writeHead(302, headers);
  res.end();
}

export function handleGoogleStart(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const cfg = googleClientConfig();
  if (!cfg) {
    return redirect(req, res, authErrorRedirect("not_configured"));
  }
  const state = newOauthState();
  const url = buildGoogleAuthorizeUrl({
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
    state,
  });
  return redirect(req, res, url, [oauthStateSetCookie(req, state)]);
}

export async function handleGoogleCallback(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const cfg = googleClientConfig();
  if (!cfg) {
    return redirect(req, res, authErrorRedirect("not_configured"));
  }
  const err = url.searchParams.get("error");
  if (err) {
    return redirect(req, res, authErrorRedirect("denied"), [
      oauthStateClearCookie(req),
    ]);
  }
  const code = url.searchParams.get("code")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  const expected = requestCookies(req)[OAUTH_STATE_COOKIE] ?? "";
  if (!code || !state || !expected || state !== expected) {
    return redirect(req, res, authErrorRedirect("bad_state"), [
      oauthStateClearCookie(req),
    ]);
  }
  const exchanged = await exchangeGoogleCode({
    code,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    redirectUri: cfg.redirectUri,
    fetchImpl,
  });
  if (!exchanged.ok) {
    return redirect(req, res, authErrorRedirect("exchange_failed"), [
      oauthStateClearCookie(req),
    ]);
  }
  const login = completeGoogleLogin(exchanged.profile);
  if (!login.ok) {
    return redirect(req, res, authErrorRedirect(login.error), [
      oauthStateClearCookie(req),
    ]);
  }
  return redirect(req, res, authSuccessRedirect(), [
    oauthStateClearCookie(req),
    sessionSetCookie(req, login.token),
  ]);
}
