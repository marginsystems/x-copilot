/**
 * Operator allowlist. Unset ADMIN_EMAILS → nobody is admin (fail closed).
 */

export function parseAdminEmails(
  raw: string | undefined = process.env.ADMIN_EMAILS,
): string[] {
  const fromEnv = (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(fromEnv)];
}

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return parseAdminEmails().includes(email.trim().toLowerCase());
}
