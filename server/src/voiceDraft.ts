/**
 * Deterministic hygiene for suggested replies. The model still sees the
 * voice card; this is the last gate so em dashes and stock AI templates
 * cannot reach the textarea.
 */

export const EM_DASH = "\u2014";

/** Replace typographic em dashes with a period so the draft stays readable.
 *  Capitalize the word after the inserted period so the continuation does
 *  not read as a lowercased fragment. */
export function stripEmDashes(text: string): string {
  return text
    .replace(/\s*\u2014\s*([A-Za-z])/g, (_m: string, ch: string) => `. ${ch.toUpperCase()}`)
    .replace(/\s*\u2014\s*/g, ". ")
    .replace(/\s{2,}/g, " ")
    .replace(/\.\s+\./g, ".")
    .trim();
}

const THIS_ISNT_CONTRAST =
  /\b(?:this|that|it)\s+(?:isn['’]t|is not)\b[^.,;]{0,80}[.,]\s*\b(?:it['’]s|it is)\b/i;
const ITS_NOT_CONTRAST = /\bit['’]s not\b[^.,;]{0,80}[.,]\s*\bit['’]s\b/i;

/**
 * True when text runs on the "this isn't X, it's Y" contrast cadence the
 * stock-AI gate flags. The voice card copies the operator's exemplar posts
 * verbatim, so this is how we tell the gate to make an exception when that
 * cadence is genuinely the operator's own voice.
 */
export function textUsesContrastCadence(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  return THIS_ISNT_CONTRAST.test(t) || ITS_NOT_CONTRAST.test(t);
}

/**
 * Stock assistant formulas: "if X, then Y" and "this isn't X, it's Y".
 * After em-dash strip, the contrast form is usually two clauses.
 */
export function draftHasAiTropes(
  text: string,
  original?: string,
  opts?: { allowContrastCadence?: boolean },
): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (/\bif\b[^.,;]{0,90},\s+then\b/i.test(t)) return true;
  const src = original ?? t;
  if (/\bif\b[^\u2014.,;]{0,90}\u2014\s*then\b/i.test(src)) return true;
  if (!opts?.allowContrastCadence && textUsesContrastCadence(t)) return true;
  return false;
}

export function sanitizeSuggestedDraft(text: string): string {
  return stripEmDashes(text);
}

/** Posts that assume a side before we should draft a reply. */
export function postNeedsStance(opts: {
  threadKind?: string | null;
  flags?: string[] | null;
}): boolean {
  const kind = (opts.threadKind ?? "").trim().toLowerCase();
  if (kind === "sharp_opinion" || kind === "timely_take") return true;
  return (opts.flags ?? []).some(
    (flag) => flag === "political" || flag === "rage_bait",
  );
}
