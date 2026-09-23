/** Initials for the menu avatar when no Google/X photo is stored. */
export function menuInitials(
  displayName: string | null | undefined,
  email: string | null | undefined,
  handle: string | null | undefined,
): string {
  const source = (displayName || handle || email || "?").trim();
  const bare = source.replace(/@.*$/, "").replace(/^@+/, "");
  const parts = bare.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  }
  const one = parts[0] || bare || "?";
  return one.slice(0, 2).toUpperCase();
}

/** Prefer a stored Google/X photo; otherwise nothing (UI shows initials). */
export function menuAvatarUrl(
  stored: string | null | undefined,
): string | null {
  const url = stored?.trim() ?? "";
  return url.startsWith("https://") ? url : null;
}
