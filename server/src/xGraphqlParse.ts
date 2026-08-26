/**
 * Legacy X GraphQL SearchTimeline response parsing.
 * Used by tweet lookup and retained fixture tests; no HTTP client.
 */
import { MAX_OP_TEXT_CHARS, type ThreadCard } from "./threadCard.js";
import {
  mediaShortlinkKeys,
  nodeHasOutboundLink,
  type LinkPreviewCard,
  type UrlEntity,
} from "./xLinks.js";

type TimelineInstruction = {
  entries?: TimelineEntry[];
  addEntries?: { entries?: TimelineEntry[] };
};

type TimelineEntry = {
  entryId?: string;
  content?: {
    __typename?: string;
    cursorType?: string;
    value?: string;
    itemContent?: {
      tweet_results?: { result?: unknown };
    };
    items?: Array<{
      item?: {
        itemContent?: {
          tweet_results?: { result?: unknown };
        };
      };
    }>;
  };
};

export type SearchTimelinePage = {
  threads: ThreadCard[];
  bottomCursor: string | null;
};

/** Parse one SearchTimeline page: tweets + Bottom cursor for pagination. */
export function parseSearchTimelinePage(data: unknown): SearchTimelinePage {
  const root = data as {
    data?: {
      search_by_raw_query?: {
        search_timeline?: {
          timeline?: { instructions?: TimelineInstruction[] };
        };
      };
    };
  };
  const instructions =
    root?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
    [];
  const cards: ThreadCard[] = [];
  let bottomCursor: string | null = null;
  for (const instr of instructions) {
    const entries = instr.entries || instr.addEntries?.entries || [];
    for (const entry of entries) {
      const content = entry.content;
      const typename = content?.__typename;
      const cursorType = content?.cursorType;
      const cursorValue =
        typeof content?.value === "string" ? content.value.trim() : "";
      const isBottom =
        typename === "TimelineTimelineCursor" &&
        (cursorType === "Bottom" ||
          /cursor-bottom/i.test(entry.entryId ?? ""));
      if (isBottom && cursorValue) {
        bottomCursor = cursorValue;
      }

      const fromItem = content?.itemContent?.tweet_results?.result;
      if (fromItem) {
        const card = tweetResultToCard(fromItem);
        if (card) cards.push(card);
      }
      for (const item of content?.items || []) {
        const result = item.item?.itemContent?.tweet_results?.result;
        if (result) {
          const card = tweetResultToCard(result);
          if (card) cards.push(card);
        }
      }
    }
  }
  return { threads: cards, bottomCursor };
}

/** Parse SearchTimeline GraphQL JSON into thread cards (exported for tests). */
export function parseSearchTimelineResponse(data: unknown): ThreadCard[] {
  return parseSearchTimelinePage(data).threads;
}

export type TweetResultNode = {
  __typename?: string;
  rest_id?: string;
  legacy?: {
    full_text?: string;
    created_at?: string;
    id_str?: string;
    user_id_str?: string;
    screen_name?: string;
    conversation_id_str?: string;
    in_reply_to_status_id_str?: string;
    in_reply_to_screen_name?: string;
    entities?: {
      urls?: UrlEntity[];
      media?: UrlEntity[];
    };
  };
  core?: {
    user_results?: {
      result?: {
        core?: { screen_name?: string };
        legacy?: { screen_name?: string };
        affiliates_highlighted_label?: {
          label?: {
            description?: string;
            userLabelType?: string;
            longDescription?: { text?: string };
          };
        };
      };
    };
  };
  note_tweet?: {
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
  /** Link-preview / summary card (shape varies by GraphQL build). */
  card?: LinkPreviewCard;
  /** X Articles / longform article payloads (shape varies by GraphQL build). */
  article?: unknown;
  article_results?: unknown;
  tweet?: unknown;
  quoted_status_result?: { result?: unknown };
};

function noteTweetText(node: TweetResultNode): string | undefined {
  const text = node.note_tweet?.note_tweet_results?.result?.text;
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function hasArticlePayload(node: TweetResultNode): boolean {
  if (typeof node.article === "object" && node.article !== null) return true;
  if (
    typeof node.article_results === "object" &&
    node.article_results !== null
  ) {
    return true;
  }
  return false;
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

function unwrapTweetNode(result: unknown): TweetResultNode | null {
  if (!result || typeof result !== "object") return null;
  const node = result as TweetResultNode;
  if (node.__typename === "TweetWithVisibilityResults" && node.tweet) {
    return node.tweet as TweetResultNode;
  }
  return node;
}

function screenNameFromNode(node: TweetResultNode): string | undefined {
  return (
    node.core?.user_results?.result?.core?.screen_name ||
    node.core?.user_results?.result?.legacy?.screen_name ||
    node.legacy?.screen_name
  );
}

/**
 * True when the tweet author carries X's Automated account badge.
 * Only `AutomatedLabel` — other affiliate badges must not match.
 */
export function userIsAutomated(result: unknown): boolean {
  const node = unwrapTweetNode(result);
  if (!node) return false;
  const label = node.core?.user_results?.result?.affiliates_highlighted_label
    ?.label;
  if (!label) return false;
  if (label.userLabelType === "AutomatedLabel") return true;
  // Fallback only when GraphQL omits userLabelType but still sends the badge copy.
  return (
    !label.userLabelType &&
    label.description?.trim().toLowerCase() === "automated"
  );
}

/** Extract quoted / parent root author+text when GraphQL inlined it. */
export function extractOpContext(node: TweetResultNode): {
  opAuthor?: string;
  opText?: string;
} {
  const quoted = unwrapTweetNode(node.quoted_status_result?.result);
  if (!quoted) return {};
  const noteText = noteTweetText(quoted);
  const text = resolveCardText(quoted.legacy?.full_text, noteText);
  const handle = screenNameFromNode(quoted);
  if (!text || !handle) return {};
  return {
    opAuthor: handle.startsWith("@") ? handle : `@${handle}`,
    opText: text.slice(0, MAX_OP_TEXT_CHARS),
  };
}

/** Public parse of a GraphQL tweet result node into a ThreadCard. */
export function tweetResultToCard(result: unknown): ThreadCard | null {
  const inner = unwrapTweetNode(result);
  if (!inner) return null;

  const id = inner.rest_id || inner.legacy?.id_str;
  const noteText = noteTweetText(inner);
  const text = resolveCardText(inner.legacy?.full_text, noteText);
  const handle = screenNameFromNode(inner);
  if (!id || !text || !handle) return null;

  const isArticle = hasArticlePayload(inner);
  const longform: ThreadCard["longform"] = isArticle
    ? "article"
    : noteText
      ? "note_tweet"
      : undefined;

  const inReplyToId = inner.legacy?.in_reply_to_status_id_str?.trim();
  const inReplyToScreenName =
    inner.legacy?.in_reply_to_screen_name?.trim() || undefined;
  const conversationId = inner.legacy?.conversation_id_str?.trim();
  const op = extractOpContext(inner);

  const quoted = unwrapTweetNode(inner.quoted_status_result?.result);
  const hasOutboundLink =
    nodeHasOutboundLink(inner) ||
    (quoted ? nodeHasOutboundLink(quoted) : false);
  const mediaShortlinks = [
    ...mediaShortlinkKeys(
      inner.legacy?.entities,
      inner.note_tweet?.note_tweet_results?.result?.entity_set,
    ),
  ];

  const isAutomated = userIsAutomated(inner);
  const card: ThreadCard = {
    id: String(id),
    author: handle.startsWith("@") ? handle : `@${handle}`,
    text,
    url: `https://x.com/${handle.replace(/^@/, "")}/status/${id}`,
    createdAt: inner.legacy?.created_at,
    ...(longform ? { longform } : {}),
    ...(hasOutboundLink ? { hasOutboundLink: true } : {}),
    ...(isAutomated ? { isAutomated: true } : {}),
    ...(mediaShortlinks.length ? { mediaShortlinks } : {}),
  };
  if (inReplyToId) {
    card.inReplyToId = inReplyToId;
    card.isReply = true;
  }
  if (inReplyToScreenName) {
    card.inReplyToScreenName = inReplyToScreenName.startsWith("@")
      ? inReplyToScreenName
      : `@${inReplyToScreenName}`;
  }
  if (conversationId) card.conversationId = conversationId;
  if (inner.quoted_status_result) card.isQuote = true;
  if (op.opAuthor) card.opAuthor = op.opAuthor;
  if (op.opText) card.opText = op.opText;
  return card;
}
