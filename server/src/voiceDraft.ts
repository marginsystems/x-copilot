/**
 * Deterministic hygiene for suggested replies. The model still sees the
 * voice card; this is the last gate so em dashes and stock AI templates
 * cannot reach the textarea.
 */

export const EM_DASH = "\u2014";

/** Replace typographic em dashes with a period so the draft stays readable. */
export function stripEmDashes(text: string): string {
  return text
    .replace(/\s*\u2014\s*/g, ". ")
    .replace(/\s{2,}/g, " ")
    .replace(/\.\s+\./g, ".")
    .trim();
}

/**
 * Stock assistant formulas: "if X, then Y" and "this isn't X, it's Y".
 * After em-dash strip, the contrast form is usually two clauses.
 */
export function draftHasAiTropes(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (/\bif\b.{0,90},\s+then\b/i.test(t)) return true;
  if (
    /\b(?:this|that|it)\s+(?:isn['’]t|is not)\b.{0,80}\b(?:it['’]s|it is)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\bit['’]s not\b.{0,80}\bit['’]s\b/i.test(t)) return true;
  return false;
}

export function sanitizeSuggestedDraft(text: string): string {
  return stripEmDashes(text);
}
