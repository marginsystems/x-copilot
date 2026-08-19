/**
 * Scout takeoff requires an official X OAuth link, not a typed handle.
 */
import type { AuthUser } from "./authStore.js";
import { userNeedsXHandle } from "./authStore.js";

export const X_LINK_REQUIRED = {
  error: "x_link_required",
  message: "Link X with the official login before Take off.",
} as const;

export function xLinkRequiredResponse(
  user: AuthUser | null | undefined,
): { error: string; message: string } | null {
  if (!user || !userNeedsXHandle(user)) return null;
  return {
    error: X_LINK_REQUIRED.error,
    message: X_LINK_REQUIRED.message,
  };
}
