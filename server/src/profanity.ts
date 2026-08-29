/**
 * Pre-triage English profanity word list. Obfuscations (f*ck) are out of scope.
 * Keep this list short — Settings dropProfanity is the control, not a slur encyclopedia.
 */
const PROFANITY_RE =
  /\b(?:fuck(?:ing|ed|er|s)?|motherfuck(?:er|ing|ers)?|shit(?:ty|s)?|bullshit|asshole(?:s)?|bitch(?:es|y)?|cunt(?:s)?|whore(?:s)?|slut(?:s)?|wanker(?:s)?|twat(?:s)?)\b/i;

export function textHasProfanity(text: string): boolean {
  return PROFANITY_RE.test(text);
}

export function threadHasProfanity(thread: {
  text?: string;
  opText?: string;
}): boolean {
  if (thread.text && textHasProfanity(thread.text)) return true;
  if (thread.opText && textHasProfanity(thread.opText)) return true;
  return false;
}
