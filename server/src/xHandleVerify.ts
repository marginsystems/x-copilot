/**
 * Verify a public X username (app bearer lookup) and persist it on the user.
 * Used by onboarding and Settings — not an OAuth link.
 */
import { setUserXUsername, type AuthUser } from "./authStore.js";
import { parseXHandle } from "./xHandle.js";
import { resetUserVoiceCorpus } from "./voiceStore.js";
import {
  lookupXUserByUsername,
  type XUserLookupOk,
  type XUserLookupFail,
} from "./xApi.js";

export type VerifyXHandleResult =
  | { ok: true; handle: string }
  | { ok: false; status: number; error: string; message: string };

export type ApplyXUsernameResult =
  | { ok: true; user: AuthUser; changed: boolean }
  | { ok: false; status: number; error: string; message: string };

type LookupFn = (
  username: string,
) => Promise<XUserLookupOk | XUserLookupFail>;

export async function verifyPublicXHandle(
  raw: unknown,
  lookup: LookupFn = lookupXUserByUsername,
): Promise<VerifyXHandleResult> {
  const parsed = parseXHandle(typeof raw === "string" ? raw : "");
  if (!parsed) {
    return {
      ok: false,
      status: 400,
      error: "needs_x_handle",
      message: "Enter your X username so we can find your replies.",
    };
  }
  const looked = await lookup(parsed);
  if (looked.ok) return { ok: true, handle: looked.user.screen_name };
  if (looked.error === "missing_credentials") {
    return {
      ok: false,
      status: 503,
      error: "x_api_unavailable",
      message:
        "Could not verify that X username — this server isn't connected to the X API yet. Try again later.",
    };
  }
  if (looked.error === "user_not_found" || looked.status === 404) {
    return {
      ok: false,
      status: 400,
      error: "x_user_not_found",
      message: `No X account named @${parsed}.`,
    };
  }
  return {
    ok: false,
    status: looked.status || 502,
    error: looked.error,
    message: looked.message || "Could not verify that X username.",
  };
}

/** Persist a verified public handle. Same value (any case) skips the lookup. */
export async function applyVerifiedXUsername(opts: {
  user: AuthUser;
  raw: unknown;
  lookup?: LookupFn;
}): Promise<ApplyXUsernameResult> {
  const parsed = parseXHandle(typeof opts.raw === "string" ? opts.raw : "");
  if (!parsed) {
    return {
      ok: false,
      status: 400,
      error: "needs_x_handle",
      message: "Enter your X username so we can find your replies.",
    };
  }
  const current = parseXHandle(opts.user.xUsername ?? "");
  if (current && current.toLowerCase() === parsed.toLowerCase()) {
    return { ok: true, user: opts.user, changed: false };
  }
  const verified = await verifyPublicXHandle(parsed, opts.lookup);
  if (!verified.ok) return verified;
  const updated = setUserXUsername(opts.user.id, verified.handle);
  if (!updated) {
    return {
      ok: false,
      status: 404,
      error: "not_found",
      message: "User not found.",
    };
  }
  // A new handle is a different X account. Drop the previous account's
  // voice corpus (replies, folded own_posts, card, counts, cursors) so the
  // re-ingest and hourly pulls start fresh instead of blending two accounts.
  resetUserVoiceCorpus(opts.user.id);
  return { ok: true, user: updated, changed: true };
}
