import type { AppView } from "./appView";

/** Matches index.html — one product tagline, everywhere. */
export const SITE_TITLE =
  "x-copilot — the X copilot for growing your account";

export const SITE_DESCRIPTION =
  "The For You feed optimizes for your attention, not your growth. x-copilot curates the X threads worth your reply — scored to your agenda, in your style. You review, edit, and post yourself. Free plan, no credit card. Not affiliated with X Corp.";

export const PRICING_TITLE = "Pricing — x-copilot";
export const PRICING_DESCRIPTION =
  "Free, Pulse ($12), Radar ($36), and Horizon ($99). Credits, daily takeoffs, watch posts, and voice suggests. No credit card for Free. Not affiliated with X Corp.";

export const CHANGELOG_TITLE = "Changelog — x-copilot";
export const CHANGELOG_DESCRIPTION =
  "What shipped on x-copilot. Newest first. Launch notes, not a blog. Not affiliated with X Corp.";

export const PRIVACY_TITLE = "Privacy Policy — x-copilot";
export const TERMS_TITLE = "Terms of Service — x-copilot";
export const LEGAL_DESCRIPTION =
  "How Mergestorm, Inc. runs x-copilot: what we store, how Suggest and desk posting work, and the terms for using the desk.";

export type RobotsDirective = "index,follow" | "noindex,follow";

export type SeoMeta = {
  title: string;
  description: string;
  robots: RobotsDirective;
};

/** Privacy and Terms stay public and linked. They should not rank. */
export function robotsForView(view: AppView): RobotsDirective {
  return view === "privacy" || view === "terms"
    ? "noindex,follow"
    : "index,follow";
}

export function seoForView(view: AppView): SeoMeta {
  const robots = robotsForView(view);
  if (view === "privacy") {
    return { title: PRIVACY_TITLE, description: LEGAL_DESCRIPTION, robots };
  }
  if (view === "terms") {
    return { title: TERMS_TITLE, description: LEGAL_DESCRIPTION, robots };
  }
  if (view === "pricing") {
    return { title: PRICING_TITLE, description: PRICING_DESCRIPTION, robots };
  }
  if (view === "changelog") {
    return { title: CHANGELOG_TITLE, description: CHANGELOG_DESCRIPTION, robots };
  }
  return { title: SITE_TITLE, description: SITE_DESCRIPTION, robots };
}

export function applyRobotsMeta(
  doc: Pick<Document, "head" | "querySelector" | "createElement">,
  robots: RobotsDirective,
): void {
  let el = doc.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!el) {
    el = doc.createElement("meta");
    el.setAttribute("name", "robots");
    doc.head.appendChild(el);
  }
  el.setAttribute("content", robots);
}
