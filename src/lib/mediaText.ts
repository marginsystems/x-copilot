/**
 * Strip native-media t.co shortlinks from post text for card display.
 * Keys match ThreadCard.mediaShortlinks (`t.co/<code>` lowercased).
 * Keep in sync with server/src/mediaText.ts.
 */

/** Normalize a t.co shortlink for set membership checks. */
export function normalizeTcoKey(url: string): string | null {
  const m = /(?:https?:\/\/)?t\.co\/([A-Za-z0-9]+)/i.exec(url.trim());
  return m ? `t.co/${m[1]}`.toLowerCase() : null;
}

/**
 * Remove known native-media shortlinks from text. Leaves real outbound URLs
 * and unknown/ambiguous bare t.co codes untouched.
 */
export function stripMediaShortlinksFromText(
  text: string,
  mediaShortlinks: readonly string[] | undefined,
): string {
  if (!mediaShortlinks?.length) return text;
  const keys = new Set(
    mediaShortlinks
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.startsWith("t.co/")),
  );
  if (!keys.size) return text;

  return text
    .replace(/(?:https?:\/\/)?t\.co\/[A-Za-z0-9]+/gi, (match) => {
      const key = normalizeTcoKey(match);
      return key && keys.has(key) ? "" : match;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .trim();
}
