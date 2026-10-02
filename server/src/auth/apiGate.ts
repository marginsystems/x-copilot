import type { IncomingMessage } from "node:http";
import { isOriginAllowed, requestOrigin } from "../http/cors.js";
import { authRequired, isPublicApiPath } from "./authGuard.js";
import { getSessionUser, requestBearerToken } from "./sessionCookie.js";

export type ApiGateRefusal =
  | { status: 403; error: "forbidden"; message: "Origin not allowed" }
  | { status: 401; error: "unauthenticated"; message: "Sign in required" };

const ORIGIN_REFUSAL: ApiGateRefusal = {
  status: 403,
  error: "forbidden",
  message: "Origin not allowed",
};

export function apiGateRefusal(
  req: IncomingMessage,
  pathname: string,
): ApiGateRefusal | null {
  if (!authRequired() || isPublicApiPath(pathname)) return null;
  const bearer = requestBearerToken(req) !== null;
  if (!bearer && !isOriginAllowed(requestOrigin(req))) return ORIGIN_REFUSAL;
  if (!getSessionUser(req)) {
    return { status: 401, error: "unauthenticated", message: "Sign in required" };
  }
  return null;
}
