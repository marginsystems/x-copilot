/**
 * GET /api/scout/profile — the session user's Scout familiarity (C13).
 *
 * Same projection and loader as the boot `desk.scoutFamiliarity` slice, so a
 * desk refresh sees exactly what first paint saw at the same evidence
 * revision. The owner comes only from the session cookie; query and body
 * selectors are ignored. The route is not public-allowlisted: the index
 * gate runs first, and the handler repeats the session check so direct
 * calls (tests) keep the same policy. Reads only; never starts a Scout run.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { authRequired } from "../auth/authGuard.js";
import { getSessionUser } from "../auth/sessionCookie.js";
import { send } from "../http/httpJson.js";
import {
  loadScoutFamiliarity,
  type ScoutFamiliarityLoader,
} from "./scoutFamiliarity.js";

export const SCOUT_PROFILE_PATH = "/api/scout/profile";

export const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export type ScoutProfileHttpDeps = {
  /** Injectable owned-profile read (tests). Production uses the store. */
  loadScoutProfile?: ScoutFamiliarityLoader;
};

export async function tryHandleScoutProfile(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: ScoutProfileHttpDeps = {},
): Promise<boolean> {
  if (url.pathname !== SCOUT_PROFILE_PATH) return false;
  if (req.method !== "GET") return false;

  const required = authRequired();
  const user = getSessionUser(req);
  if (!user && required) {
    send(
      req,
      res,
      401,
      { ok: false, error: "unauthenticated", authRequired: required },
      PRIVATE_NO_STORE,
    );
    return true;
  }

  // No session under optional auth: nothing to own, so nothing is read.
  const scoutFamiliarity = user
    ? await loadScoutFamiliarity(user.id, deps.loadScoutProfile)
    : null;
  send(req, res, 200, { ok: true, scoutFamiliarity }, PRIVATE_NO_STORE);
  return true;
}
