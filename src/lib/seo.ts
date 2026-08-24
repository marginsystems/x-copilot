import type { AppView } from "./appView";

/** Matches index.html — one product tagline, everywhere. */
export const SITE_TITLE =
  "x-copilot — the X copilot for growing your account";

export const SITE_DESCRIPTION =
  "The For You feed optimizes for your attention, not your growth. x-copilot curates the X threads worth your reply — scored to your agenda, in your style. You review, edit, and post yourself. Free plan, no credit card. Not affiliated with X Corp.";

export const PRICING_TITLE = "Pricing — x-copilot";
export const PRICING_DESCRIPTION =
  "Free, Pulse ($12), Radar ($36), and Horizon ($99). Credits, daily takeoffs, watch posts, and voice suggests. No credit card for Free. Not affiliated with X Corp.";

export const PRIVACY_TITLE = "Privacy Policy — x-copilot";
export const TERMS_TITLE = "Terms of Service — x-copilot";
export const LEGAL_DESCRIPTION =
  "How Mergestorm, Inc. runs x-copilot: what we store, how Suggest and desk posting work, and the terms for using the desk.";

export type SeoMeta = {
  title: string;
  description: string;
};

export function seoForView(view: AppView): SeoMeta {
  if (view === "privacy") {
    return { title: PRIVACY_TITLE, description: LEGAL_DESCRIPTION };
  }
  if (view === "terms") {
    return { title: TERMS_TITLE, description: LEGAL_DESCRIPTION };
  }
  if (view === "pricing") {
    return { title: PRICING_TITLE, description: PRICING_DESCRIPTION };
  }
  return { title: SITE_TITLE, description: SITE_DESCRIPTION };
}
