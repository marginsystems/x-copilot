/** Public X usernames (no OAuth) — used for reply detect. */

export function normalizeXHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "");
}

/** X handle rules: 1–15 letters, digits, underscore. */
export function parseXHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const handle = normalizeXHandle(raw);
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
  return handle;
}
