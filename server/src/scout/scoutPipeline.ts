/**
 * Shared Scout filtering applied after reply-parent hydration.
 */
import {
  filterByLanguage,
  filterHashtags,
  filterMinViews,
  filterNativeMedia,
  filterOutboundLinks,
  filterProfanity,
  filterSelfReplies,
  filterThreadsByLength,
  type LengthFilterOptions,
  type PreferredLanguageCode,
} from "./threadFilters.js";
import type { ThreadCard } from "./threadCard.js";

export function filterPostHydrateThreads(opts: {
  threads: ThreadCard[];
  preferredLanguage: PreferredLanguageCode;
  maxChars: number;
  lengthOptions?: LengthFilterOptions;
  dropOutboundLinks?: boolean;
  dropNativeMedia?: boolean;
  dropHashtags?: boolean;
  dropProfanity?: boolean;
  filterByMinViews?: boolean;
  minViews?: number;
}) {
  // Hydration can reveal same-author replies that lacked an early author hint.
  const afterSelfReply = filterSelfReplies(opts.threads);
  const afterMinViews = filterMinViews(afterSelfReply.threads, {
    filterByMinViews: opts.filterByMinViews,
    minViews: opts.minViews,
    allowUnknownReplyViews: true,
  });
  // OP/quoted root links are usually only visible after hydrate.
  const afterLinks = filterOutboundLinks(afterMinViews.threads, {
    dropOutboundLinks: opts.dropOutboundLinks,
  });
  const afterMedia = filterNativeMedia(afterLinks.threads, {
    dropNativeMedia: opts.dropNativeMedia,
  });
  const afterHashtags = filterHashtags(afterMedia.threads, {
    dropHashtags: opts.dropHashtags,
  });
  const afterProfanity = filterProfanity(afterHashtags.threads, {
    dropProfanity: opts.dropProfanity,
  });
  // Re-check language now that reply-parent OP context is available (#121).
  const afterLanguage = filterByLanguage(
    afterProfanity.threads,
    opts.preferredLanguage,
  );
  const afterLength = filterThreadsByLength(
    afterLanguage.threads,
    opts.maxChars,
    opts.lengthOptions,
  );

  return {
    afterSelfReply,
    afterMinViews,
    afterLinks,
    afterMedia,
    afterHashtags,
    afterProfanity,
    afterLanguage,
    afterLength,
  };
}
