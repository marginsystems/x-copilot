/** Ledger remix: view-count brag, sharper-hook, or double-down on an old own post. */
export function isOwnPostRemixCopy(
  why: string,
  draft?: string | null,
): boolean {
  const whyText = why.toLowerCase();
  const all = `${whyText} ${draft?.toLowerCase() ?? ""}`;
  if (/sharper hook|double down|best shape/.test(all)) return true;
  if (/\b\d+(?:\.\d+)?k\s*-?\s*views?\b/.test(all)) return true;
  if (/\bgot\s+\d+\s+views?\b/.test(all)) return true;
  if (/\b\d+\s+views?\b/.test(whyText)) return true;
  return false;
}
