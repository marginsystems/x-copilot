import { hasOptional, hasOptionalStrings, isArrayOf, isNumber, isString } from "../platform/unknownValue.js";
import type { V2Tweet, V2User } from "./xV2Card.js";
import type { UrlEntity } from "./xLinks.js";

export function isV2User(value: unknown): value is V2User {
  return hasOptionalStrings(value, "id", "username", "name");
}

function isUrlEntity(value: unknown): value is UrlEntity {
  return hasOptionalStrings(value, "url", "expanded_url", "display_url");
}

function isEntities(value: unknown): value is NonNullable<V2Tweet["entities"]> {
  return hasOptional(value, "urls", (items) => isArrayOf(items, isUrlEntity)) &&
    hasOptional(value, "media", (items) => isArrayOf(items, isUrlEntity));
}

function isNoteTweet(value: unknown): value is NonNullable<V2Tweet["note_tweet"]> {
  return hasOptionalStrings(value, "text") && hasOptional(value, "entity_set", isEntities);
}

function isMetrics(value: unknown): value is NonNullable<V2Tweet["public_metrics"]> {
  return hasOptional(value, "like_count", isNumber) &&
    hasOptional(value, "reply_count", isNumber) &&
    hasOptional(value, "retweet_count", isNumber) &&
    hasOptional(value, "quote_count", isNumber) &&
    hasOptional(value, "impression_count", isNumber);
}

export function isV2Tweet(value: unknown): value is V2Tweet {
  return hasOptionalStrings(value, "id", "text", "author_id", "created_at", "conversation_id", "in_reply_to_user_id", "card_uri") &&
    hasOptional(value, "referenced_tweets", (items) => isArrayOf(items, (item) => hasOptionalStrings(item, "type", "id"))) &&
    hasOptional(value, "entities", isEntities) &&
    hasOptional(value, "attachments", (item) => hasOptional(item, "media_keys", (keys) => isArrayOf(keys, isString))) &&
    hasOptional(value, "note_tweet", isNoteTweet) &&
    hasOptional(value, "public_metrics", isMetrics);
}
