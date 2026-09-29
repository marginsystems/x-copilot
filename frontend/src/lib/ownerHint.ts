export const OWNER_HINT_COOKIE = "xc_owner";

const OWNER_HINT_PATTERN = /^[0-9a-f]{32}$/;

export function isOwnerHint(value: unknown): value is string {
  return typeof value === "string" && OWNER_HINT_PATTERN.test(value);
}

function documentCookie(): string {
  try {
    return typeof document === "undefined" ? "" : document.cookie;
  } catch {
    return "";
  }
}

export function readOwnerHint(cookie: string = documentCookie()): string | null {
  try {
    for (const part of cookie.split(";")) {
      const separator = part.indexOf("=");
      if (separator < 0) continue;
      if (part.slice(0, separator).trim() !== OWNER_HINT_COOKIE) continue;
      const value = part.slice(separator + 1).trim();
      return isOwnerHint(value) ? value : null;
    }
  } catch {
    return null;
  }
  return null;
}
