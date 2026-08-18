/**
 * Forced-edit gate: cheap local rejection of trivial rewrites before the
 * DeepSeek verify call, plus the x.com intent URL builder for the fallback
 * when the desk cannot post as them.
 */

export type TrivialEditReason =
  | "empty"
  | "unchanged"
  | "cosmetic_only"
  | "too_small";

export type TrivialEditVerdict =
  | { trivial: true; reason: TrivialEditReason }
  | { trivial: false };

/** Collapse to the letters/digits that carry meaning: case, punctuation and
 * whitespace changes all normalize away. */
export function normalizeForEditCompare(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Bounded Levenshtein — returns min(distance, cap + 1). */
export function editDistanceCapped(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const sub = prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, sub);
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j]!;
  }
  return Math.min(prev[b.length]!, cap + 1);
}

/**
 * Reject whitespace-only, punctuation-only, case-only, and one-or-two
 * character edits locally. Substantive edits still go to DeepSeek for the
 * real sign-off — this only filters the obvious "added a period" case.
 */
export function checkTrivialEdit(
  draft: string,
  edited: string,
): TrivialEditVerdict {
  const editedTrim = edited.trim();
  if (!editedTrim) return { trivial: true, reason: "empty" };
  if (draft.trim() === editedTrim) {
    return { trivial: true, reason: "unchanged" };
  }
  const a = normalizeForEditCompare(draft);
  const b = normalizeForEditCompare(editedTrim);
  if (!b) return { trivial: true, reason: "cosmetic_only" };
  if (a === b) return { trivial: true, reason: "cosmetic_only" };
  if (editDistanceCapped(a, b, 2) <= 2) {
    return { trivial: true, reason: "too_small" };
  }
  return { trivial: false };
}

/** Short, kind editor note per local rejection. */
export function trivialEditNote(reason: TrivialEditReason): string {
  switch (reason) {
    case "empty":
      return "The reply is empty — write something in your own words first.";
    case "unchanged":
      return "This is still the draft word for word. Make it yours — swap a phrase, add a thought.";
    case "cosmetic_only":
      return "Punctuation, spacing, or capitalization alone doesn't count. Change something real.";
    case "too_small":
      return "That's a very small touch. Rework a clause or add your own take.";
  }
}

/** X post length gate (client mirrors this; URLs aside, keep it simple). */
export const MAX_REPLY_CHARS = 280;

/**
 * Web intent URL — opens x.com compose prefilled as a reply. The human taps
 * Post there; this app never writes tweets.
 */
export function buildIntentUrl(inReplyToId: string, text: string): string {
  const id = inReplyToId.trim();
  if (!/^\d+$/.test(id)) {
    throw new Error("in_reply_to must be a numeric status id");
  }
  const params = new URLSearchParams({ in_reply_to: id, text });
  return `https://x.com/intent/tweet?${params.toString()}`;
}
