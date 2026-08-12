/**
 * X API credentials + verify (official app-only Bearer).
 * Replaces browser session cookies (auth_token / ct0).
 */

import {
  getXApiCredsFromEnv,
  xApiGet,
  type XApiCreds,
} from "./xApi.js";

/** @deprecated Prefer XApiCreds — kept name for caller compatibility. */
export type SessionCreds = XApiCreds;

export type VerifyOk = {
  ok: true;
  method: string;
  user: {
    id: string;
    screen_name: string;
    name: string;
    protected: boolean;
  };
  warning?: string;
};

export type VerifyFail = {
  ok: false;
  status: number;
  error: string;
  message?: string;
};

export type VerifyResult = VerifyOk | VerifyFail;

export function getSessionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SessionCreds {
  return getXApiCredsFromEnv(env);
}

/** @deprecated No-op shim — callers should use xApiGet / buildXApiHeaders. */
export function buildSessionHeaders(
  _creds: Pick<SessionCreds, "bearerToken">,
): Record<string, string> {
  return {
    Authorization: `Bearer ${_creds.bearerToken}`,
    Accept: "application/json",
  };
}

async function verifyViaApi(session: SessionCreds): Promise<VerifyResult> {
  const username = session.operatorUsername;
  const userId = session.operatorUserId;

  if (username) {
    const res = await xApiGet({
      path: `/users/by/username/${encodeURIComponent(username)}`,
      query: { "user.fields": "protected,name,username" },
      creds: session,
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: res.error,
        message: res.message,
      };
    }
    const data = res.json as {
      data?: {
        id?: string;
        username?: string;
        name?: string;
        protected?: boolean;
      };
    };
    const u = data.data;
    if (!u?.id || !u.username) {
      return {
        ok: false,
        status: 503,
        error: "user_not_found",
        message: `No X user for username ${username}.`,
      };
    }
    return {
      ok: true,
      method: "api_users_by_username",
      user: {
        id: u.id,
        screen_name: u.username,
        name: u.name || u.username,
        protected: Boolean(u.protected),
      },
    };
  }

  if (userId) {
    const res = await xApiGet({
      path: `/users/${encodeURIComponent(userId)}`,
      query: { "user.fields": "protected,name,username" },
      creds: session,
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: res.error,
        message: res.message,
      };
    }
    const data = res.json as {
      data?: {
        id?: string;
        username?: string;
        name?: string;
        protected?: boolean;
      };
    };
    const u = data.data;
    if (!u?.id || !u.username) {
      return {
        ok: false,
        status: 503,
        error: "user_not_found",
        message: `No X user for id ${userId}.`,
      };
    }
    return {
      ok: true,
      method: "api_users_by_id",
      user: {
        id: u.id,
        screen_name: u.username,
        name: u.name || u.username,
        protected: Boolean(u.protected),
      },
    };
  }

  // No operator identity configured — cheap auth probe via a tiny public lookup.
  const probe = await xApiGet({
    path: "/users/by/username/X",
    query: { "user.fields": "username" },
    creds: session,
  });
  if (!probe.ok) {
    return {
      ok: false,
      status: probe.status,
      error: probe.error,
      message: probe.message,
    };
  }
  return {
    ok: true,
    method: "api_bearer_probe",
    user: {
      id: "",
      screen_name: "unknown",
      name: "unknown",
      protected: false,
    },
    warning:
      "Bearer works. Set X_OPERATOR_USERNAME (and optionally X_OPERATOR_USER_ID) for Mark detect / reply discover.",
  };
}

/** Operator identity never changes for the process lifetime; cache successful API lookups. */
let apiVerifyCache: { key: string; result: VerifyOk } | undefined;

/**
 * Prove the X API bearer works and resolve operator identity.
 * Prefers X_OPERATOR_USERNAME / X_OPERATOR_USER_ID from env.
 */
export async function verifySession(
  session: SessionCreds = getSessionFromEnv(),
): Promise<VerifyResult> {
  if (!session.configured) {
    return {
      ok: false,
      status: 0,
      error: "missing_credentials",
      message: "Set X_API_BEARER_TOKEN in .env (Pay Per Use app bearer).",
    };
  }

  const key = [
    session.bearerToken,
    session.operatorUsername,
    session.operatorUserId,
  ].join("|");
  if (apiVerifyCache?.key === key) return apiVerifyCache.result;
  const result = await verifyViaApi(session);
  if (result.ok) apiVerifyCache = { key, result };
  return result;
}
