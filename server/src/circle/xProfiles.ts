import { isRecord, objectValue } from "../platform/unknownValue.js";
import { parseXHandle } from "../auth/xHandle.js";
import { normalizeAuthorKey } from "../desk/interactionCooldown.js";
import { enlargeXAvatarUrl } from "../x-api/xAvatar.js";

export type XProfile = {
  authorKey: string;
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  updatedAt: string;
};

export type XUserRecord = XProfile & { id: string | null };

export const X_USERS_BY_MAX = 100;

export function parseXUser(raw: unknown, updatedAt: string): XUserRecord | null {
  if (!isRecord(raw)) return null;
  const handle = parseXHandle(raw.username);
  if (!handle) return null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : null;
  const image =
    typeof raw.profile_image_url === "string" ? raw.profile_image_url.trim() : "";
  const id = typeof raw.id === "string" && /^\d+$/.test(raw.id) ? raw.id : null;
  return {
    id,
    authorKey: normalizeAuthorKey(handle),
    handle,
    name,
    avatarUrl: image.startsWith("https://") ? enlargeXAvatarUrl(image) : null,
    updatedAt,
  };
}

export function parseXUsers(raw: unknown, updatedAt: string): XUserRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const user = parseXUser(item, updatedAt);
    return user ? [user] : [];
  });
}

export function parseXUsersByResponse(json: unknown, updatedAt: string): XProfile[] {
  return parseXUsers(objectValue(json).data, updatedAt).map(toXProfile);
}

export function toXProfile(user: XUserRecord): XProfile {
  return {
    authorKey: user.authorKey,
    handle: user.handle,
    name: user.name,
    avatarUrl: user.avatarUrl,
    updatedAt: user.updatedAt,
  };
}
