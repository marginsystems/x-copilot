/**
 * Native-media vs outbound-link predicates used by both GraphQL and v2 card
 * converters. Pure URL / entity math — no X client.
 */
import { normalizeTcoKey } from "./mediaText.js";

export type UrlEntity = {
  url?: string;
  expanded_url?: string;
  display_url?: string;
};

export type LinkPreviewCard = {
  rest_id?: string;
  legacy?: {
    name?: string;
    url?: string;
    binding_values?: Array<{
      key?: string;
      value?: {
        string_value?: string;
        scribe_key?: string;
      };
    }>;
  };
};

type NoteTweetEntities = {
  note_tweet_results?: {
    result?: {
      text?: string;
      entity_set?: {
        urls?: UrlEntity[];
        media?: UrlEntity[];
      };
    };
  };
};

const NATIVE_MEDIA_HOST_RE =
  /(?:^|\.)(?:pic\.twitter\.com|pic\.x\.com|pbs\.twimg\.com|video\.twimg\.com)(?:\/|$)/i;
/** e.g. https://twitter.com/<user>/status/<id>/photo/<n> or .../video/<n>. */
const TWITTER_MEDIA_PATH_RE =
  /^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^/]+\/status\/\d+\/(?:photo|video)\//i;
const X_SITE_HOST_RE =
  /^(?:www\.|mobile\.|m\.)?(?:twitter\.com|x\.com)$/i;
const OUTBOUND_URL_IN_TEXT_RE = /https?:\/\/[^\s]+|t\.co\/[A-Za-z0-9]+/gi;

/** Native X Article permalink (not a status URL). */
export function isXArticleUrl(url: string): boolean {
  return /(?:^|\/\/)(?:www\.)?(?:x|twitter)\.com\/i\/article(?:\/|$|\?)/i.test(
    url.trim(),
  );
}

/** True when URL is native X media (not an outbound link attachment). */
export function isNativeMediaUrl(url: string): boolean {
  const raw = url.trim();
  if (!raw) return false;
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withScheme).hostname;
    return (
      NATIVE_MEDIA_HOST_RE.test(host) || TWITTER_MEDIA_PATH_RE.test(withScheme)
    );
  } catch {
    return NATIVE_MEDIA_HOST_RE.test(raw) || TWITTER_MEDIA_PATH_RE.test(raw);
  }
}

/** True when URL stays on X / Twitter (status, profile, article, media). */
export function isXSiteUrl(url: string): boolean {
  const raw = url.trim();
  if (!raw) return false;
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withScheme).hostname;
    return X_SITE_HOST_RE.test(host) || NATIVE_MEDIA_HOST_RE.test(host);
  } catch {
    return false;
  }
}

/**
 * Official v2 `tweet.fields=card_uri`. X does not return the card landing
 * URL (daventys.com etc.) — only `card://…`. Native cards (polls
 * `poll://…`, Spaces `audiospace://…`, live `broadcast://…`) and X
 * Articles stay on-platform, so only the website/summary `card://` scheme
 * counts as outbound.
 */
export function hasCardUri(cardUri: unknown): boolean {
  return (
    typeof cardUri === "string" && /^card:\/\//i.test(cardUri.trim())
  );
}

/** True when a URL string is an off-platform (non-X, non-media) link. */
export function isOutboundLinkUrl(url: string): boolean {
  const raw = url.trim();
  if (!raw) return false;
  if (!/^https?:\/\//i.test(raw) && !/^t\.co\//i.test(raw)) return false;
  if (isNativeMediaUrl(raw) || isXSiteUrl(raw)) return false;
  return true;
}

/** t.co shortlinks for native media: URLs expanded to media hosts, plus media-entity t.co keys. */
export function mediaShortlinkKeys(
  ...entitySets: Array<
    { urls?: UrlEntity[]; media?: UrlEntity[] } | undefined
  >
): Set<string> {
  const keys = new Set<string>();
  for (const entities of entitySets) {
    if (!entities || typeof entities !== "object") continue;
    for (const u of entities.urls ?? []) {
      const expanded =
        typeof u.expanded_url === "string" ? u.expanded_url.trim() : "";
      if (!expanded || !isNativeMediaUrl(expanded)) continue;
      for (const c of [u.url, u.expanded_url, u.display_url]) {
        if (typeof c !== "string") continue;
        const key = normalizeTcoKey(c);
        if (key) keys.add(key);
      }
    }
    for (const m of entities.media ?? []) {
      for (const c of [m.url, m.expanded_url, m.display_url]) {
        if (typeof c !== "string") continue;
        const key = normalizeTcoKey(c);
        if (key) keys.add(key);
      }
    }
  }
  return keys;
}

/**
 * True when candidate text contains an outbound link (media excluded).
 * Bare t.co shortlinks are ambiguous (native media vs outbound) when their
 * entity is absent, so they never count here. X rewrites every URL to t.co;
 * the follow-through is `entities.urls[].expanded_url` (and cards), not an
 * extra HTTP hop.
 */
export function textHasOutboundLink(text: string): boolean {
  const matches = text.match(OUTBOUND_URL_IN_TEXT_RE);
  if (!matches) return false;
  for (const m of matches) {
    const cleaned = m.replace(/[),.!?;:]+$/g, "");
    if (normalizeTcoKey(cleaned)) continue;
    if (isOutboundLinkUrl(cleaned)) return true;
  }
  return false;
}

export function entityUrlsHaveOutbound(urls: UrlEntity[] | undefined): boolean {
  if (!Array.isArray(urls)) return false;
  for (const u of urls) {
    // Prefer expanded_url so t.co → pic.twitter.com is treated as media.
    const expanded =
      typeof u.expanded_url === "string" ? u.expanded_url.trim() : "";
    if (expanded) {
      if (isNativeMediaUrl(expanded)) continue;
      if (isOutboundLinkUrl(expanded)) return true;
      continue;
    }
    for (const c of [u.url, u.display_url]) {
      if (typeof c === "string" && isOutboundLinkUrl(c)) return true;
    }
  }
  return false;
}

export function cardHasOutboundLink(
  card: LinkPreviewCard | undefined,
  ignoreShortlinks: Set<string>,
): boolean {
  if (!card || typeof card !== "object") return false;
  const legacy = card.legacy;
  if (!legacy) return false;
  if (typeof legacy.url === "string" && isOutboundLinkUrl(legacy.url)) {
    return true;
  }
  const bindings = legacy.binding_values;
  if (!Array.isArray(bindings)) return false;
  for (const b of bindings) {
    const key = (b.key ?? "").toLowerCase();
    const val = b.value?.string_value;
    if (typeof val !== "string" || !val.trim()) continue;
    if (
      key.includes("url") ||
      key === "card_url" ||
      key === "vanity_url" ||
      key === "website_url"
    ) {
      const tco = normalizeTcoKey(val);
      const isMediaShortlink = tco !== null && ignoreShortlinks.has(tco);
      if (!isMediaShortlink && isOutboundLinkUrl(val)) return true;
      if (textHasOutboundLink(val)) return true;
    }
  }
  return false;
}

function noteTweetText(node: { note_tweet?: NoteTweetEntities }): string | undefined {
  const text = node.note_tweet?.note_tweet_results?.result?.text;
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveCardText(
  fullText: string | undefined,
  noteText: string | undefined,
): string | undefined {
  const legacy = typeof fullText === "string" ? fullText.trim() : "";
  const note = noteText ?? "";
  if (!legacy && !note) return undefined;
  if (note.length > legacy.length) return note;
  if (legacy.length > 0) return legacy;
  return note;
}

/** Detect off-platform links on a GraphQL tweet node (candidate or quoted/parent). */
export function nodeHasOutboundLink(node: {
  legacy?: {
    full_text?: string;
    entities?: { urls?: UrlEntity[]; media?: UrlEntity[] };
  };
  card?: LinkPreviewCard;
  note_tweet?: NoteTweetEntities;
}): boolean {
  const legacyEntities = node.legacy?.entities;
  const noteEntities =
    node.note_tweet?.note_tweet_results?.result?.entity_set;
  const ignore = mediaShortlinkKeys(legacyEntities, noteEntities);
  if (entityUrlsHaveOutbound(legacyEntities?.urls)) return true;
  if (entityUrlsHaveOutbound(noteEntities?.urls)) return true;
  if (cardHasOutboundLink(node.card, ignore)) return true;
  const noteText = noteTweetText(node);
  const text = resolveCardText(node.legacy?.full_text, noteText);
  if (text && textHasOutboundLink(text)) return true;
  return false;
}
