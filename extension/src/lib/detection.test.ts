import { describe, expect, it } from "vitest";
import { cardDetected, cardKey, detectionTag, nextCardSince, parseCardSince } from "./detection";

const lock = {
  id: "123",
  conversationId: null,
  inReplyToId: null,
  surface: "reply" as const,
  author: "@dana",
  url: null,
  text: null,
};

describe("card detection", () => {
  it("marks a Scout card detected once the extension saw a reply to it", () => {
    expect(cardDetected({ lock, repliedCardId: "123", replySeenAtMs: null, since: null })).toBe(true);
    expect(cardDetected({ lock, repliedCardId: "999", replySeenAtMs: 5, since: null })).toBe(false);
    expect(detectionTag(lock, true)).toEqual({ label: "Reply detected", detected: true });
    expect(detectionTag(lock, false)).toEqual({ label: "Waiting for your reply", detected: false });
  });

  it("marks For You detected only for a post seen after that card appeared", () => {
    const since = { key: cardKey(null), sinceMs: 1_000 };
    expect(cardDetected({ lock: null, repliedCardId: null, replySeenAtMs: 1_500, since })).toBe(true);
    expect(cardDetected({ lock: null, repliedCardId: null, replySeenAtMs: 900, since })).toBe(false);
    expect(cardDetected({ lock: null, repliedCardId: null, replySeenAtMs: null, since })).toBe(false);
    expect(cardDetected({ lock: null, repliedCardId: null, replySeenAtMs: 1_500, since: { key: "123", sinceMs: 0 } })).toBe(false);
    expect(detectionTag(null, true).label).toBe("Post detected");
  });

  it("keeps the start time while the same card is showing and restarts on a new card", () => {
    const first = nextCardSince(null, "for_you", 1_000);
    expect(first).toEqual({ key: "for_you", sinceMs: 1_000 });
    expect(nextCardSince(first, "for_you", 5_000)).toBe(first);
    expect(nextCardSince(first, "card:123", 5_000)).toEqual({ key: "card:123", sinceMs: 5_000 });
    expect(cardKey({ ...lock, id: "for_you" })).not.toBe(cardKey(null));
  });

  it("reads only well-formed stored values", () => {
    expect(parseCardSince({ key: "for_you", sinceMs: 1 })).toEqual({ key: "for_you", sinceMs: 1 });
    for (const bad of [null, {}, { key: "", sinceMs: 1 }, { key: "a", sinceMs: "1" }]) {
      expect(parseCardSince(bad)).toBeNull();
    }
  });
});
