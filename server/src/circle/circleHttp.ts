import type { IncomingMessage, ServerResponse } from "node:http";
import { getSessionUser } from "../auth/sessionCookie.js";
import { parseXHandle } from "../auth/xHandle.js";
import { normalizeAuthorKey } from "../desk/interactionCooldown.js";
import {
  listInteractionHistory,
  MAX_INTERACTION_STORE,
} from "../desk/interactionStore.js";
import { requestCreditsExhausted } from "../http/httpGates.js";
import { send } from "../http/httpJson.js";
import { getXApiCredsFromEnv, xApiGet } from "../x-api/xApi.js";
import { buildCircle, CIRCLE_LIMIT, type CircleMember } from "./circleStats.js";
import {
  circleSelfHandle,
  getXProfiles,
  listCircleLinks,
  upsertXProfiles,
} from "./circleStore.js";
import { listPendingQuotePosts, resolveQuoteTargets } from "./circleQuotes.js";
import { parseXUsersByResponse, X_USERS_BY_MAX, type XProfile } from "./xProfiles.js";

export const CIRCLE_HYDRATE_INTERVAL_MS = 10 * 60_000;
export const CIRCLE_PROFILE_STALE_MS = 7 * 24 * 60 * 60_000;

const lastHydrateAt = new Map<string, number>();
const lastQuoteResolveAt = new Map<string, number>();

export function resetCircleHydrationForTests(): void {
  lastHydrateAt.clear();
  lastQuoteResolveAt.clear();
}

async function withDisconnectSignal<T>(
  req: IncomingMessage,
  res: ServerResponse,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const disconnect = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) disconnect.abort();
  };
  req.on("close", onClose);
  try {
    return await run(disconnect.signal);
  } finally {
    req.off("close", onClose);
  }
}

async function resolveCircleQuotes(
  req: IncomingMessage,
  res: ServerResponse,
  userId: string,
  nowMs: number,
): Promise<void> {
  const last = lastQuoteResolveAt.get(userId);
  if (last !== undefined && nowMs - last < CIRCLE_HYDRATE_INTERVAL_MS) return;
  if (!getXApiCredsFromEnv().configured) return;
  if (listPendingQuotePosts(userId, 1).length === 0) return;
  if (requestCreditsExhausted(req)) return;
  try {
    const result = await withDisconnectSignal(req, res, (signal) =>
      resolveQuoteTargets({ userId, nowMs, signal }),
    );
    if (!result.failed) lastQuoteResolveAt.set(userId, nowMs);
  } catch (err) {
    console.warn("circle quote resolve soft-fail:", err);
  }
}

function circleHydrationAllowed(userId: string, nowMs: number): boolean {
  const last = lastHydrateAt.get(userId);
  return last === undefined || nowMs - last >= CIRCLE_HYDRATE_INTERVAL_MS;
}

export function staleCircleHandles(
  members: readonly CircleMember[],
  profiles: ReadonlyMap<string, XProfile>,
  nowMs: number,
): string[] {
  return members
    .flatMap((member) => {
      const handle = parseXHandle(member.handle);
      if (!handle) return [];
      const profile = profiles.get(normalizeAuthorKey(handle));
      if (!profile?.avatarUrl) return [handle];
      const updatedMs = Date.parse(profile.updatedAt);
      return Number.isFinite(updatedMs) && nowMs - updatedMs <= CIRCLE_PROFILE_STALE_MS
        ? []
        : [handle];
    })
    .slice(0, X_USERS_BY_MAX);
}

export async function hydrateCircleProfiles(opts: {
  handles: readonly string[];
  nowMs: number;
  signal?: AbortSignal;
  fetchUsers?: typeof xApiGet;
}): Promise<number> {
  const handles = opts.handles.slice(0, X_USERS_BY_MAX);
  if (handles.length === 0) return 0;
  const result = await (opts.fetchUsers ?? xApiGet)({
    path: "/users/by",
    query: {
      usernames: handles.join(","),
      "user.fields": "profile_image_url,name",
    },
    signal: opts.signal,
    timeoutMs: 8000,
  });
  if (!result.ok) {
    console.warn("circle profile hydrate failed:", result.error, result.message);
    return 0;
  }
  return upsertXProfiles(
    parseXUsersByResponse(result.json, new Date(opts.nowMs).toISOString()),
  );
}

export async function tryHandleCircle(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (req.method !== "GET" || url.pathname !== "/api/circle") return false;
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    send(
      req,
      res,
      401,
      { error: "unauthenticated", message: "Sign in required" },
      { "Cache-Control": "no-store" },
    );
    return true;
  }
  const userId = sessionUser.id;
  const nowMs = Date.now();
  const selfHandle = circleSelfHandle(userId);
  const history = await listInteractionHistory({ userId, limit: MAX_INTERACTION_STORE });
  await resolveCircleQuotes(req, res, userId, nowMs);
  const links = listCircleLinks(userId);
  const draft = buildCircle({ selfHandle, history, links, profiles: [], limit: CIRCLE_LIMIT });
  const topKeys = draft.members.map((member) => normalizeAuthorKey(member.handle));
  let profiles = getXProfiles(topKeys);
  const stale = staleCircleHandles(draft.members, profiles, nowMs);
  if (
    stale.length > 0 &&
    getXApiCredsFromEnv().configured &&
    circleHydrationAllowed(userId, nowMs)
  ) {
    try {
      if (!requestCreditsExhausted(req)) {
        lastHydrateAt.set(userId, nowMs);
        const written = await withDisconnectSignal(req, res, (signal) =>
          hydrateCircleProfiles({ handles: stale, nowMs, signal }),
        );
        if (written > 0) profiles = getXProfiles(topKeys);
      }
    } catch (err) {
      console.warn("circle profile hydrate soft-fail:", err);
    }
  }
  const circle = buildCircle({
    selfHandle,
    history,
    links,
    profiles: [...profiles.values()],
    limit: CIRCLE_LIMIT,
  });
  send(
    req,
    res,
    200,
    {
      handle: selfHandle,
      name: sessionUser.displayName,
      avatarUrl: sessionUser.avatarUrl,
      generatedAt: new Date(nowMs).toISOString(),
      members: circle.members,
      totals: circle.totals,
    },
    { "Cache-Control": "private, no-cache" },
  );
  return true;
}
