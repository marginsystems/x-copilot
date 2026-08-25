import { pathFromView, type AppView } from "./appView";
import { CHANGELOG } from "./changelog";
import {
  LEARN_DESCRIPTION,
  LEARN_FOLLOW_DESCRIPTION,
  LEARN_FOLLOW_HEADING,
  LEARN_FOLLOW_TITLE,
  LEARN_HEADING,
  LEARN_OON_HREF,
  LEARN_PARAM_FILE_HREF,
  LEARN_SOURCE_DATE,
  LEARN_SOURCE_REPO,
  LEARN_SOURCE_SHA,
  LEARN_TITLE,
} from "./learn";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_ENTITY,
  PRODUCT_NAME,
  SITE_ORIGIN,
} from "./legal";

/** Matches index.html — one product tagline, everywhere. */
export const SITE_TITLE =
  "x-copilot — the X copilot for growing your account";

export const SITE_DESCRIPTION =
  "The For You feed optimizes for your attention, not your growth. x-copilot curates the X threads worth your reply — scored to your agenda, in your style. You review, edit, and post yourself. Free plan, no credit card. Not affiliated with X Corp.";

export const PRICING_TITLE = "Pricing — x-copilot";
export const PRICING_DESCRIPTION =
  "Free, Pulse ($12), Radar ($36), and Horizon ($99). Credits, daily takeoffs, watch posts, and voice suggests. No credit card for Free. Not affiliated with X Corp.";

export const CHANGELOG_TITLE = "Changelog — what shipped on x-copilot";
export const CHANGELOG_DESCRIPTION =
  "Launch notes for x-copilot, newest first. Voice cards, flight-path images, Approach, and the desk. Not a blog. Not affiliated with X Corp.";

export { LEARN_TITLE, LEARN_DESCRIPTION, LEARN_FOLLOW_TITLE, LEARN_FOLLOW_DESCRIPTION };

export const PRIVACY_TITLE = "Privacy Policy — x-copilot";
export const TERMS_TITLE = "Terms of Service — x-copilot";
export const LEGAL_DESCRIPTION =
  "How Mergestorm, Inc. runs x-copilot: what we store, how Suggest and desk posting work, and the terms for using the desk.";

export const SITE_IMAGE = "/og.png";
export const SITE_IMAGE_ALT =
  "x-copilot wordmark and scout reticle on a dark field";
export const CHANGELOG_IMAGE = "/og-changelog.png";
export const CHANGELOG_IMAGE_ALT =
  "x-copilot changelog — a quiet altitude line on a dark field";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export type RobotsDirective = "index,follow" | "noindex,follow";

export type SeoMeta = {
  title: string;
  description: string;
  robots: RobotsDirective;
  image: string;
  imageAlt: string;
};

type SeoDoc = Pick<Document, "head" | "querySelector" | "createElement">;

/** Privacy and Terms stay public and linked. They should not rank. */
export function robotsForView(view: AppView): RobotsDirective {
  return view === "privacy" || view === "terms"
    ? "noindex,follow"
    : "index,follow";
}

export function seoForView(view: AppView): SeoMeta {
  const robots = robotsForView(view);
  if (view === "privacy") {
    return {
      title: PRIVACY_TITLE,
      description: LEGAL_DESCRIPTION,
      robots,
      image: SITE_IMAGE,
      imageAlt: SITE_IMAGE_ALT,
    };
  }
  if (view === "terms") {
    return {
      title: TERMS_TITLE,
      description: LEGAL_DESCRIPTION,
      robots,
      image: SITE_IMAGE,
      imageAlt: SITE_IMAGE_ALT,
    };
  }
  if (view === "pricing") {
    return {
      title: PRICING_TITLE,
      description: PRICING_DESCRIPTION,
      robots,
      image: SITE_IMAGE,
      imageAlt: SITE_IMAGE_ALT,
    };
  }
  if (view === "changelog") {
    return {
      title: CHANGELOG_TITLE,
      description: CHANGELOG_DESCRIPTION,
      robots,
      image: CHANGELOG_IMAGE,
      imageAlt: CHANGELOG_IMAGE_ALT,
    };
  }
  if (view === "learn") {
    return {
      title: LEARN_TITLE,
      description: LEARN_DESCRIPTION,
      robots,
      image: SITE_IMAGE,
      imageAlt: SITE_IMAGE_ALT,
    };
  }
  if (view === "learnFollow") {
    return {
      title: LEARN_FOLLOW_TITLE,
      description: LEARN_FOLLOW_DESCRIPTION,
      robots,
      image: SITE_IMAGE,
      imageAlt: SITE_IMAGE_ALT,
    };
  }
  return {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    robots,
    image: SITE_IMAGE,
    imageAlt: SITE_IMAGE_ALT,
  };
}

export function absoluteSeoUrl(path: string): string {
  return `${SITE_ORIGIN}${path}`;
}

export function softwareApplicationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: PRODUCT_NAME,
    url: `${SITE_ORIGIN}/`,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "An X copilot that curates the threads worth your reply — scored to your agenda, in your style. You review, edit, and post yourself. Free plan with 1,500 monthly credits, no credit card.",
    creator: {
      "@type": "Organization",
      name: LEGAL_ENTITY,
      url: "https://mergestorm.ai/",
      email: LEGAL_CONTACT_EMAIL,
    },
    image: absoluteSeoUrl(SITE_IMAGE),
    offers: {
      "@type": "AggregateOffer",
      lowPrice: "0",
      highPrice: "99",
      priceCurrency: "USD",
      offerCount: "4",
    },
  };
}

export function changelogJsonLd(): Record<string, unknown> {
  const pageUrl = `${SITE_ORIGIN}/changelog`;
  const orgId = `${SITE_ORIGIN}/#organization`;
  const appId = `${SITE_ORIGIN}/#app`;
  const siteId = `${SITE_ORIGIN}/#website`;
  const pageId = `${pageUrl}#page`;
  const listId = `${pageUrl}#list`;
  const newest = CHANGELOG[0]?.date ?? "";
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId,
        name: LEGAL_ENTITY,
        url: "https://mergestorm.ai/",
        email: LEGAL_CONTACT_EMAIL,
      },
      {
        "@type": "SoftwareApplication",
        "@id": appId,
        name: PRODUCT_NAME,
        url: `${SITE_ORIGIN}/`,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        image: absoluteSeoUrl(SITE_IMAGE),
        creator: { "@id": orgId },
      },
      {
        "@type": "WebSite",
        "@id": siteId,
        url: `${SITE_ORIGIN}/`,
        name: PRODUCT_NAME,
        publisher: { "@id": orgId },
        inLanguage: "en-US",
      },
      {
        "@type": "CollectionPage",
        "@id": pageId,
        url: pageUrl,
        name: CHANGELOG_TITLE,
        description: CHANGELOG_DESCRIPTION,
        isPartOf: { "@id": siteId },
        about: { "@id": appId },
        image: absoluteSeoUrl(CHANGELOG_IMAGE),
        inLanguage: "en-US",
        dateModified: newest,
        mainEntity: { "@id": listId },
        publisher: { "@id": orgId },
        breadcrumb: { "@id": `${pageUrl}#breadcrumb` },
      },
      {
        "@type": "ItemList",
        "@id": listId,
        name: CHANGELOG_TITLE,
        itemListOrder: "https://schema.org/ItemListOrderDescending",
        numberOfItems: CHANGELOG.length,
        itemListElement: CHANGELOG.map((entry, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: entry.href ?? pageUrl,
          item: {
            "@type": "CreativeWork",
            name: entry.title,
            description: entry.body,
            datePublished: entry.date,
            url: entry.href ?? pageUrl,
            isPartOf: { "@id": pageId },
            publisher: { "@id": orgId },
          },
        })),
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${pageUrl}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: PRODUCT_NAME,
            item: `${SITE_ORIGIN}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Changelog",
            item: pageUrl,
          },
        ],
      },
    ],
  };
}

export function learnJsonLd(): Record<string, unknown> {
  const pageUrl = `${SITE_ORIGIN}/learn`;
  const orgId = `${SITE_ORIGIN}/#organization`;
  const appId = `${SITE_ORIGIN}/#app`;
  const siteId = `${SITE_ORIGIN}/#website`;
  const pageId = `${pageUrl}#page`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId,
        name: LEGAL_ENTITY,
        url: "https://mergestorm.ai/",
        email: LEGAL_CONTACT_EMAIL,
      },
      {
        "@type": "SoftwareApplication",
        "@id": appId,
        name: PRODUCT_NAME,
        url: `${SITE_ORIGIN}/`,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        image: absoluteSeoUrl(SITE_IMAGE),
        creator: { "@id": orgId },
      },
      {
        "@type": "WebSite",
        "@id": siteId,
        url: `${SITE_ORIGIN}/`,
        name: PRODUCT_NAME,
        publisher: { "@id": orgId },
        inLanguage: "en-US",
      },
      {
        "@type": "Article",
        "@id": pageId,
        url: pageUrl,
        name: LEARN_TITLE,
        headline: LEARN_HEADING,
        description: LEARN_DESCRIPTION,
        isPartOf: { "@id": siteId },
        about: { "@id": appId },
        image: absoluteSeoUrl(SITE_IMAGE),
        inLanguage: "en-US",
        dateModified: LEARN_SOURCE_DATE,
        citation: LEARN_PARAM_FILE_HREF,
        publisher: { "@id": orgId },
        breadcrumb: { "@id": `${pageUrl}#breadcrumb` },
        sameAs: `${LEARN_SOURCE_REPO}/tree/${LEARN_SOURCE_SHA}`,
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${pageUrl}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: PRODUCT_NAME,
            item: `${SITE_ORIGIN}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: LEARN_HEADING,
            item: pageUrl,
          },
        ],
      },
    ],
  };
}

export function learnFollowJsonLd(): Record<string, unknown> {
  const pageUrl = `${SITE_ORIGIN}/learn/follow`;
  const learnUrl = `${SITE_ORIGIN}/learn`;
  const orgId = `${SITE_ORIGIN}/#organization`;
  const appId = `${SITE_ORIGIN}/#app`;
  const siteId = `${SITE_ORIGIN}/#website`;
  const pageId = `${pageUrl}#page`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId,
        name: LEGAL_ENTITY,
        url: "https://mergestorm.ai/",
        email: LEGAL_CONTACT_EMAIL,
      },
      {
        "@type": "SoftwareApplication",
        "@id": appId,
        name: PRODUCT_NAME,
        url: `${SITE_ORIGIN}/`,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        image: absoluteSeoUrl(SITE_IMAGE),
        creator: { "@id": orgId },
      },
      {
        "@type": "WebSite",
        "@id": siteId,
        url: `${SITE_ORIGIN}/`,
        name: PRODUCT_NAME,
        publisher: { "@id": orgId },
        inLanguage: "en-US",
      },
      {
        "@type": "Article",
        "@id": pageId,
        url: pageUrl,
        name: LEARN_FOLLOW_TITLE,
        headline: LEARN_FOLLOW_HEADING,
        description: LEARN_FOLLOW_DESCRIPTION,
        isPartOf: { "@id": siteId },
        about: { "@id": appId },
        image: absoluteSeoUrl(SITE_IMAGE),
        inLanguage: "en-US",
        dateModified: LEARN_SOURCE_DATE,
        citation: LEARN_OON_HREF,
        publisher: { "@id": orgId },
        breadcrumb: { "@id": `${pageUrl}#breadcrumb` },
        sameAs: `${LEARN_SOURCE_REPO}/tree/${LEARN_SOURCE_SHA}`,
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${pageUrl}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: PRODUCT_NAME,
            item: `${SITE_ORIGIN}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: LEARN_HEADING,
            item: learnUrl,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: LEARN_FOLLOW_HEADING,
            item: pageUrl,
          },
        ],
      },
    ],
  };
}

export function jsonLdForView(view: AppView): Record<string, unknown> {
  if (view === "changelog") return changelogJsonLd();
  if (view === "learn") return learnJsonLd();
  if (view === "learnFollow") return learnFollowJsonLd();
  return softwareApplicationJsonLd();
}

export function applyRobotsMeta(doc: SeoDoc, robots: RobotsDirective): void {
  upsertMeta(doc, 'meta[name="robots"]', { name: "robots" }, robots);
}

export function applyDocumentSeo(doc: SeoDoc & Pick<Document, "title">, view: AppView): void {
  const seo = seoForView(view);
  const canonical = absoluteSeoUrl(pathFromView(view));
  const image = absoluteSeoUrl(seo.image);
  doc.title = seo.title;
  const link = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  link?.setAttribute("href", canonical);
  upsertMeta(doc, 'meta[name="description"]', { name: "description" }, seo.description);
  upsertMeta(doc, 'meta[property="og:url"]', { property: "og:url" }, canonical);
  upsertMeta(doc, 'meta[property="og:title"]', { property: "og:title" }, seo.title);
  upsertMeta(
    doc,
    'meta[property="og:description"]',
    { property: "og:description" },
    seo.description,
  );
  upsertMeta(doc, 'meta[property="og:image"]', { property: "og:image" }, image);
  upsertMeta(doc, 'meta[property="og:image:alt"]', { property: "og:image:alt" }, seo.imageAlt);
  upsertMeta(doc, 'meta[name="twitter:title"]', { name: "twitter:title" }, seo.title);
  upsertMeta(
    doc,
    'meta[name="twitter:description"]',
    { name: "twitter:description" },
    seo.description,
  );
  upsertMeta(doc, 'meta[name="twitter:image"]', { name: "twitter:image" }, image);
  upsertMeta(doc, 'meta[name="twitter:image:alt"]', { name: "twitter:image:alt" }, seo.imageAlt);
  applyRobotsMeta(doc, seo.robots);
  applyJsonLd(doc, jsonLdForView(view));
}

/** Rewrite the SPA shell so `/changelog` HTML is crawlable without JS. */
export function htmlWithSeo(html: string, view: AppView): string {
  const seo = seoForView(view);
  const canonical = absoluteSeoUrl(pathFromView(view));
  const image = absoluteSeoUrl(seo.image);
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeText(seo.title)}</title>`);
  out = replaceCanonical(out, canonical);
  out = replaceMeta(out, "name", "description", seo.description);
  out = replaceMeta(out, "property", "og:url", canonical);
  out = replaceMeta(out, "property", "og:title", seo.title);
  out = replaceMeta(out, "property", "og:description", seo.description);
  out = replaceMeta(out, "property", "og:image", image);
  out = replaceMeta(out, "property", "og:image:alt", seo.imageAlt);
  out = replaceMeta(out, "name", "twitter:title", seo.title);
  out = replaceMeta(out, "name", "twitter:description", seo.description);
  out = replaceMeta(out, "name", "twitter:image", image);
  out = replaceMeta(out, "name", "twitter:image:alt", seo.imageAlt);
  out = replaceMeta(out, "name", "robots", seo.robots);
  return replaceJsonLd(out, jsonLdForView(view));
}

function upsertMeta(
  doc: SeoDoc,
  selector: string,
  attrs: Record<string, string>,
  content: string,
): void {
  let el = doc.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = doc.createElement("meta");
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    doc.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function applyJsonLd(doc: SeoDoc, data: Record<string, unknown>): void {
  let el = doc.querySelector("script[type='application/ld+json']");
  if (!el) {
    el = doc.createElement("script");
    el.setAttribute("type", "application/ld+json");
    doc.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

function replaceCanonical(html: string, href: string): string {
  const next = html.replace(
    /(<link\s+rel="canonical"\s+href=")[^"]*(")/,
    `$1${escapeAttr(href)}$2`,
  );
  if (next === html) throw new Error("missing canonical link");
  return next;
}

function replaceMeta(
  html: string,
  attr: "name" | "property",
  key: string,
  content: string,
): string {
  const re = new RegExp(
    `(<meta\\s[^>]*?${attr}="${key}"(?=\\s|/|>)[^>]*?content=")([^"]*)(")`,
  );
  if (!re.test(html)) throw new Error(`missing meta ${attr}="${key}"`);
  return html.replace(re, `$1${escapeAttr(content)}$3`);
}

function replaceJsonLd(html: string, data: Record<string, unknown>): string {
  const next = html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json">\n      ${JSON.stringify(data)}\n    </script>`,
  );
  if (next === html) throw new Error("missing JSON-LD script");
  return next;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
