export const CONSENT_KEY = "xc-cookie-consent";
export type ConsentChoice = "accepted" | "rejected";

export function parseConsent(raw: string | null | undefined): ConsentChoice | null {
  if (raw === "accepted" || raw === "rejected") return raw;
  return null;
}

export function readConsent(): ConsentChoice | null {
  try {
    return parseConsent(localStorage.getItem(CONSENT_KEY));
  } catch {
    return null;
  }
}

export function writeConsent(choice: ConsentChoice): void {
  try {
    localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    /* ignore quota / private mode */
  }
}
