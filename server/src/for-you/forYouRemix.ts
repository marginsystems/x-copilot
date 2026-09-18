/** Ledger remix: view-count brag, sharper-hook, or double-down on an old own post. */
export function isOwnPostRemixCopy(
  why: string,
  _draft?: string | null,
): boolean {
  const whyText = why.toLowerCase();
  if (/sharper hook|double down|best shape/.test(whyText)) return true;
  if (/\b\d+(?:\.\d+)?k\s*-?\s*views?\b/.test(whyText)) return true;
  if (/\bgot\s+\d+\s+views?\b/.test(whyText)) return true;
  if (/\b\d+\s+views?\b/.test(whyText)) return true;
  return false;
}
