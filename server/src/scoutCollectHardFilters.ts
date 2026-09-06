import { filterThreadsByCooldown } from "./interactionCooldown.js";
import type { ScoutRejectionCounts } from "./scoutRunStore.js";
import type { ThreadCard } from "./threadCard.js";
import {
  collectArticleConversationIds,
  filterAutomatedAccounts,
  filterByLanguage,
  filterEmDashes,
  filterExcludedAccounts,
  filterHashtags,
  filterMinViews,
  filterNativeMedia,
  filterOutboundLinks,
  filterProfanity,
  filterSelfReplies,
  filterThreadsByLength,
  type PreferredLanguageCode,
} from "./threadFilters.js";

export function applyScoutSearchHardFilters(opts: {
  threads: ThreadCard[];
  cooled: Set<string>;
  blockedConversations: Set<string>;
  dropOutboundLinks: boolean;
  dropNativeMedia: boolean;
  dropHashtags: boolean;
  preferredLanguage: PreferredLanguageCode;
  dropEmDashes: boolean;
  dropProfanity: boolean;
  dropAutomatedAccounts: boolean;
  excludedAccounts: string[];
  articleConversationIds: Set<string>;
  filterByMinViews: boolean;
  minViews?: number;
  maxChars: number;
  dropArticles: boolean;
}): {
  threads: ThreadCard[];
  rejections: Partial<ScoutRejectionCounts>;
  afterCooldown: number;
  afterSelfReply: number;
  afterLinks: number;
  afterLength: number;
  linkFilteredCount: number;
  emDashFilteredCount: number;
  profanityFilteredCount: number;
  automatedFilteredCount: number;
  excludedAccountFilteredCount: number;
  languageFilteredCount: number;
  minViewsFilteredCount: number;
} {
  const afterCool = filterThreadsByCooldown(
    opts.threads,
    opts.cooled,
    opts.blockedConversations,
  );
  const afterSelf = filterSelfReplies(afterCool.threads);
  const afterLinks = filterOutboundLinks(afterSelf.threads, {
    dropOutboundLinks: opts.dropOutboundLinks,
  });
  const afterMedia = filterNativeMedia(afterLinks.threads, {
    dropNativeMedia: opts.dropNativeMedia,
  });
  const afterHashtags = filterHashtags(afterMedia.threads, {
    dropHashtags: opts.dropHashtags,
  });
  const afterLang = filterByLanguage(
    afterHashtags.threads,
    opts.preferredLanguage,
  );
  const afterEmDash = filterEmDashes(afterLang.threads, {
    dropEmDashes: opts.dropEmDashes,
  });
  const afterProfanity = filterProfanity(afterEmDash.threads, {
    dropProfanity: opts.dropProfanity,
  });
  const afterAutomated = filterAutomatedAccounts(afterProfanity.threads, {
    dropAutomatedAccounts: opts.dropAutomatedAccounts,
  });
  const afterExcludedAccounts = filterExcludedAccounts(
    afterAutomated.threads,
    opts.excludedAccounts,
  );
  for (const id of collectArticleConversationIds(
    afterExcludedAccounts.threads,
  )) {
    opts.articleConversationIds.add(id);
  }
  const afterMinViews = filterMinViews(afterExcludedAccounts.threads, {
    filterByMinViews: opts.filterByMinViews,
    minViews: opts.minViews,
    allowUnknownReplyViews: true,
  });
  const afterLen = filterThreadsByLength(afterMinViews.threads, opts.maxChars, {
    dropArticles: opts.dropArticles,
    articleIds: opts.articleConversationIds,
  });
  return {
    threads: afterLen.threads,
    rejections: {
      cooldown: afterCool.filteredCount,
      selfReply: afterSelf.selfReplyFilteredCount,
      links: afterLinks.linkFilteredCount,
      media: afterMedia.mediaFilteredCount,
      hashtags: afterHashtags.hashtagFilteredCount,
      language: afterLang.languageFilteredCount,
      emDash: afterEmDash.emDashFilteredCount,
      profanity: afterProfanity.profanityFilteredCount,
      automatedAccount: afterAutomated.automatedFilteredCount,
      excludedAccount: afterExcludedAccounts.excludedAccountFilteredCount,
      views: afterMinViews.minViewsFilteredCount,
      articles: afterLen.articleFilteredCount,
      length: afterLen.filteredCount - afterLen.articleFilteredCount,
    },
    afterCooldown: afterCool.threads.length,
    afterSelfReply: afterSelf.threads.length,
    afterLinks: afterLinks.threads.length,
    afterLength: afterLen.threads.length,
    linkFilteredCount: afterLinks.linkFilteredCount,
    emDashFilteredCount: afterEmDash.emDashFilteredCount,
    profanityFilteredCount: afterProfanity.profanityFilteredCount,
    automatedFilteredCount: afterAutomated.automatedFilteredCount,
    excludedAccountFilteredCount:
      afterExcludedAccounts.excludedAccountFilteredCount,
    languageFilteredCount: afterLang.languageFilteredCount,
    minViewsFilteredCount: afterMinViews.minViewsFilteredCount,
  };
}
