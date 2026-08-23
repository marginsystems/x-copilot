/**
 * Shared Scout filtering applied after reply-parent hydration.
 */
import {
  filterByLanguage,
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
}) {
  // Hydration can reveal same-author replies that lacked an early author hint.
  const afterSelfReply = filterSelfReplies(opts.threads);
  // Re-check language now that reply-parent OP context is available (#121).
  const afterLanguage = filterByLanguage(
    afterSelfReply.threads,
    opts.preferredLanguage,
  );
  const afterLength = filterThreadsByLength(
    afterLanguage.threads,
    opts.maxChars,
    opts.lengthOptions,
  );

  return { afterSelfReply, afterLanguage, afterLength };
}
