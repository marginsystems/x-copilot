export const LEGAL_ENTITY = "Mergestorm, Inc.";
export const LEGAL_CONTACT_EMAIL = "contact@mergestorm.ai";
export const LEGAL_UPDATED = "August 14, 2026";
export const SITE_ORIGIN = "https://xcopilot.dev";
export const PRODUCT_NAME = "x-copilot";

export type LegalKind = "privacy" | "terms";

export function isLegalKind(value: string): value is LegalKind {
  return value === "privacy" || value === "terms";
}
