import { describe, expect, it } from "vitest";
import { X_FOR_YOU_URL, X_INSPIRATION_URL } from "../../../shared/src/forYou";
import { REPLY_PACE_MS } from "../../../shared/src/replyPace";
import { nextFromCardId, panelCanAskNext, panelCard, panelNextNotice, panelPace, preloadedNextCard, scoutOpenUrl } from "./panelModel";

const lock = {
  id: "123",
  conversationId: null,
  inReplyToId: null,
  surface: "reply" as const,
  author: "@dana",
  url: "https://x.com/dana/status/123",
  text: "A post worth reading",
};

describe("panelCard", () => {
  it("shows the locked Scout post with a reply verb", () => {
    expect(panelCard(lock)).toMatchObject({
      kind: "scout",
      verb: "Reply",
      title: "@dana",
      detail: "A post worth reading",
      openUrl: "https://x.com/dana/status/123",
      openLabel: "Open post on X",
    });
  });

  it("falls back to the For You feed when nothing is locked", () => {
    expect(panelCard(null)).toMatchObject({
      kind: "for_you",
      openUrl: X_FOR_YOU_URL,
      openLabel: "Open For You",
      secondary: { url: X_INSPIRATION_URL, label: "Open Inspiration" },
    });
    expect(panelCard(lock).secondary).toBeNull();
  });

  it("only opens x.com links and falls back to the status id", () => {
    expect(scoutOpenUrl({ ...lock, url: "https://evil.example/x" })).toBe("https://x.com/i/status/123");
    expect(scoutOpenUrl({ ...lock, url: null })).toBe("https://x.com/i/status/123");
  });
});

describe("panelPace", () => {
  const replied = Date.parse("2026-10-02T12:00:00.000Z");

  it("counts down the reply minute from the newest reply", () => {
    const pace = panelPace([new Date(replied).toISOString()], replied + 20_000);
    expect(pace).toMatchObject({ remainingMs: REPLY_PACE_MS - 20_000, clock: "0:40" });
    expect(pace?.tip).toContain("0:40");
  });

  it("is idle once the minute is over or with no replies", () => {
    expect(panelPace([new Date(replied).toISOString()], replied + REPLY_PACE_MS)).toBeNull();
    expect(panelPace([], replied)).toBeNull();
    expect(panelPace(undefined, replied)).toBeNull();
  });
});

describe("panel Next", () => {
  it("is offered only for the Scout card the extension saw a reply to", () => {
    expect(panelCanAskNext(lock, "123")).toBe(true);
    expect(panelCanAskNext(lock, "999")).toBe(false);
    expect(panelCanAskNext(lock, null)).toBe(false);
  });

  it("is always offered on the For You card, like the desk", () => {
    expect(panelCanAskNext(null, null)).toBe(true);
    expect(nextFromCardId(null)).toEqual({ forYou: true });
    expect(nextFromCardId(lock)).toEqual({ fromCardId: "123" });
  });

  it("explains when no desk is listening and when the desk is on another page", () => {
    expect(panelNextNotice("no_desk")).toContain("Open your desk dashboard");
    expect(panelNextNotice("not_moved")).toContain("as soon as its dashboard is showing");
    expect(panelNextNotice("no_card")).toContain("No new card yet");
  });
});

describe("preloadedNextCard", () => {
  const upNext = { ...lock, id: "456" };

  it("offers the desk's lined-up card when it differs from the one on screen", () => {
    expect(preloadedNextCard({ fromCardId: "123" }, { card: upNext })).toEqual({ card: upNext });
    expect(preloadedNextCard({ fromCardId: "123" }, { card: null })).toEqual({ card: null });
    expect(preloadedNextCard({ forYou: true }, { card: upNext })).toEqual({ card: upNext });
  });

  it("offers nothing when the desk named no next card or it would not move the panel", () => {
    expect(preloadedNextCard({ fromCardId: "123" }, null)).toBeNull();
    expect(preloadedNextCard({ fromCardId: "123" }, undefined)).toBeNull();
    expect(preloadedNextCard({ fromCardId: "123" }, { card: lock })).toBeNull();
    expect(preloadedNextCard({ forYou: true }, { card: null })).toBeNull();
  });
});
