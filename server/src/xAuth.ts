/**
 * X OAuth 1.0a identity login using the app consumer key/secret.
 * Does not persist user access tokens; Scout still uses the app-only bearer.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac } from "node:crypto";
import {
  createSession,
  findOauthAccount,
  getUserById,
  linkOauthToUser,
  upsertOauthUser,
  type AuthUser,
} from "./authStore.js";
import { authErrorRedirect, authSuccessRedirect } from "./authConfig.js";
import { corsHeaders } from "./cors.js";
import { buildSignedAuthHeader, parseFormEncoded } from "./oauth1.js";
import {
  appendSetCookie,
  cookieFlags,
  getSessionUser,
  requestCookies,
  serializeCookie,
  sessionSetCookie,
} from "./sessionCookie.js";
import { X_API_BASE, getXApiCredsFromEnv } from "./xApi.js";
import { parseXHandle } from "./xHandle.js";

export const X_OAUTH_COOKIE = "xc_x_oauth";
const REQUEST_TOKEN_URL = "https://api.twitter.com/oauth/request_token";
const ACCESS_TOKEN_URL = "https://api.twitter.com/oauth/access_token";
const AUTHORIZE_URL = "https://api.twitter.com/oauth/authorize";

export type XOauthProfile = {
  providerUserId: string;
  username: string;
  avatarUrl?: string | null;
};

/** X v2 returns `_normal`; the menu card wants a larger crop. */
export function enlargeXAvatarUrl(url: string): string {
  return url.replace(/_normal(\.[a-zA-Z0-9]+)?$/, (_m, ext: string | undefined) =>
    ext ? `_400x400${ext}` : "_400x400",
  );
}

export async function fetchXProfileAvatar(
  username: string,
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (env.NODE_TEST_CONTEXT) return null;
  const handle = parseXHandle(username);
  if (!handle) return null;
  const creds = getXApiCredsFromEnv(env);
  if (!creds.bearerToken) return null;
  try {
    const res = await fetchImpl(
      `${X_API_BASE}/users/by/username/${encodeURIComponent(handle)}?user.fields=profile_image_url`,
      {
        headers: {
          Authorization: `Bearer ${creds.bearerToken}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { profile_image_url?: string };
    };
    const raw = json.data?.profile_image_url?.trim() ?? "";
    if (!raw.startsWith("https://")) return null;
    return enlargeXAvatarUrl(raw);
  } catch {
    return null;
  }
}

export function xOauthCallbackUri(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env.X_OAUTH_CALLBACK?.trim();
  if (explicit) return explicit;
  const port = env.PORT?.trim() || "8787";
  return `http://127.0.0.1:${port}/api/auth/x/callback`;
}

export function xConsumerCreds(
  env: NodeJS.ProcessEnv = process.env,
): { key: string; secret: string } | null {
  const key = env.X_API_KEY?.trim() ?? "";
  const secret = env.X_API_SECRET?.trim() ?? "";
  if (!key || !secret) return null;
  return { key, secret };
}

function xOauthSetCookie(req: IncomingMessage, payload: string): string {
  const flags = cookieFlags(req);
  return serializeCookie(X_OAUTH_COOKIE, payload, {
    maxAgeSec: 10 * 60,
    httpOnly: true,
    secure: flags.secure,
    sameSite: flags.sameSite,
  });
}

function xOauthClearCookie(req: IncomingMessage): string {
  const flags = cookieFlags(req);
  return serializeCookie(X_OAUTH_COOKIE, "", {
    clear: true,
    httpOnly: true,
    secure: flags.secure,
    sameSite: flags.sameSite,
  });
}

function xOauthHmac(value: string, key: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

function xOauthSignedPayload(
  token: string,
  secret: string,
  key: string,
): string {
  const body = JSON.stringify({ token, secret });
  return JSON.stringify({ token, secret, sig: xOauthHmac(body, key) });
}

function xOauthVerifyPayload(
  raw: string,
  key: string,
): { token: string; secret: string } | null {
  let parsed: { token?: string; secret?: string; sig?: string } = {};
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return null;
  }
  if (
    typeof parsed.token !== "string" ||
    typeof parsed.secret !== "string" ||
    typeof parsed.sig !== "string"
  ) {
    return null;
  }
  const body = JSON.stringify({ token: parsed.token, secret: parsed.secret });
  if (xOauthHmac(body, key) !== parsed.sig) return null;
  return { token: parsed.token, secret: parsed.secret };
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

export async function fetchXRequestToken(opts: {
  consumerKey: string;
  consumerSecret: string;
  callbackUri: string;
  fetchImpl?: typeof fetch;
  nonce?: string;
  timestamp?: string;
}): Promise<
  | { ok: true; token: string; secret: string }
  | { ok: false; error: string }
> {
  const signed = buildSignedAuthHeader({
    method: "POST",
    url: REQUEST_TOKEN_URL,
    consumerKey: opts.consumerKey,
    consumerSecret: opts.consumerSecret,
    extraOauth: { oauth_callback: opts.callbackUri },
    nonce: opts.nonce,
    timestamp: opts.timestamp,
  });
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(REQUEST_TOKEN_URL, {
      method: "POST",
      headers: { Authorization: signed.header },
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "request_token_failed",
    };
  }
  const text = await res.text();
  if (!res.ok) return { ok: false, error: "request_token_http" };
  const parsed = parseFormEncoded(text);
  if (
    parsed.oauth_callback_confirmed !== "true" ||
    !parsed.oauth_token ||
    !parsed.oauth_token_secret
  ) {
    return { ok: false, error: "request_token_invalid" };
  }
  return {
    ok: true,
    token: parsed.oauth_token,
    secret: parsed.oauth_token_secret,
  };
}

export async function fetchXAccessToken(opts: {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
  verifier: string;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; profile: XOauthProfile }
  | { ok: false; error: string }
> {
  const signed = buildSignedAuthHeader({
    method: "POST",
    url: ACCESS_TOKEN_URL,
    consumerKey: opts.consumerKey,
    consumerSecret: opts.consumerSecret,
    token: opts.token,
    tokenSecret: opts.tokenSecret,
    extraOauth: { oauth_verifier: opts.verifier },
  });
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { Authorization: signed.header },
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "access_token_failed",
    };
  }
  const text = await res.text();
  if (!res.ok) return { ok: false, error: "access_token_http" };
  const parsed = parseFormEncoded(text);
  const userId = parsed.user_id?.trim() ?? "";
  const username = (parsed.screen_name ?? "").trim().replace(/^@/, "");
  if (!userId || !username) return { ok: false, error: "access_token_invalid" };
  return { ok: true, profile: { providerUserId: userId, username } };
}

export function completeXLogin(opts: {
  profile: XOauthProfile;
  existingUser: AuthUser | null;
}):
  | { ok: true; user: AuthUser; token: string; expiresAt: string }
  | { ok: false; error: string } {
  const { profile, existingUser } = opts;
  let user: AuthUser;
  if (existingUser) {
    const linked = linkOauthToUser({
      userId: existingUser.id,
      provider: "x",
      providerUserId: profile.providerUserId,
      username: profile.username,
      avatarUrl: existingUser.avatarUrl ? null : (profile.avatarUrl ?? null),
    });
    if (!linked.ok) return { ok: false, error: linked.error };
    user = linked.user;
  } else {
    const alreadyLinked = findOauthAccount("x", profile.providerUserId);
    const existingAvatar = alreadyLinked
      ? getUserById(alreadyLinked.userId)?.avatarUrl ?? null
      : null;
    user = upsertOauthUser({
      provider: "x",
      providerUserId: profile.providerUserId,
      username: profile.username,
      displayName: alreadyLinked ? null : profile.username,
      avatarUrl: existingAvatar ? null : (profile.avatarUrl ?? null),
      emailVerified: false,
    });
  }
  const session = createSession(user.id);
  void import("./xActivitySubscribe.js")
    .then(({ subscribeUserToPostCreate }) =>
      subscribeUserToPostCreate(user.id),
    )
    .catch((err) => console.warn("[xaa] subscribe", err));
  return { ok: true, user, token: session.token, expiresAt: session.expiresAt };
}

export async function handleXStart(
  req: IncomingMessage,
  res: ServerResponse,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const creds = xConsumerCreds();
  if (!creds) {
    return redirect(req, res, authErrorRedirect("not_configured"));
  }
  const requested = await fetchXRequestToken({
    consumerKey: creds.key,
    consumerSecret: creds.secret,
    callbackUri: xOauthCallbackUri(),
    fetchImpl,
  });
  if (!requested.ok) {
    return redirect(req, res, authErrorRedirect("exchange_failed"));
  }
  const payload = xOauthSignedPayload(requested.token, requested.secret, creds.secret);
  const loc = `${AUTHORIZE_URL}?oauth_token=${encodeURIComponent(requested.token)}`;
  return redirect(req, res, loc, [xOauthSetCookie(req, payload)]);
}

export async function handleXCallback(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const creds = xConsumerCreds();
  if (!creds) {
    return redirect(req, res, authErrorRedirect("not_configured"), [
      xOauthClearCookie(req),
    ]);
  }
  const denied = url.searchParams.get("denied");
  if (denied) {
    return redirect(req, res, authErrorRedirect("denied"), [
      xOauthClearCookie(req),
    ]);
  }
  const token = url.searchParams.get("oauth_token")?.trim() ?? "";
  const verifier = url.searchParams.get("oauth_verifier")?.trim() ?? "";
  const stored = xOauthVerifyPayload(
    requestCookies(req)[X_OAUTH_COOKIE] ?? "",
    creds.secret,
  );
  if (!token || !verifier || !stored || stored.token !== token) {
    return redirect(req, res, authErrorRedirect("bad_state"), [
      xOauthClearCookie(req),
    ]);
  }
  const access = await fetchXAccessToken({
    consumerKey: creds.key,
    consumerSecret: creds.secret,
    token,
    tokenSecret: stored.secret,
    verifier,
    fetchImpl,
  });
  if (!access.ok) {
    return redirect(req, res, authErrorRedirect("exchange_failed"), [
      xOauthClearCookie(req),
    ]);
  }
  const avatarUrl = await fetchXProfileAvatar(
    access.profile.username,
    fetchImpl,
  );
  const login = completeXLogin({
    profile: { ...access.profile, avatarUrl },
    existingUser: getSessionUser(req),
  });
  if (!login.ok) {
    return redirect(req, res, authErrorRedirect(login.error), [
      xOauthClearCookie(req),
    ]);
  }
  return redirect(req, res, authSuccessRedirect(), [
    xOauthClearCookie(req),
    sessionSetCookie(req, login.token),
  ]);
}
