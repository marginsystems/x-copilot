/**
 * Shared Scout filtering applied after reply-parent hydration.
 */
import {
  filterByLanguage,
  filterMinViews,
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
  const afterProfanity = filterProfanity(afterLinks.threads, {
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
    afterProfanity,
    afterLanguage,
    afterLength,
  };
}
