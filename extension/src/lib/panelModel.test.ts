import { describe, expect, it } from "vitest";
import { X_FOR_YOU_URL, X_INSPIRATION_URL } from "../../../shared/src/forYou";
import { REPLY_PACE_MS } from "../../../shared/src/replyPace";
import { cardActionRequest, dismissConfirmCopy, panelCardActionNotice, panelCardTarget, shownAfterRefresh, nextFromCardId, panelCanAskNext, panelDetected, panelView, panelCard, panelNextNotice, panelPace, preloadedNextCard, scoutOpenUrl } from "./panelModel";

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
  it("is offered on a Scout card before and after its reply is detected, like the desk", () => {
    const scout = { view: "scout" as const, detected: false };
    expect(panelCanAskNext(panelView(lock, scout), true, scout, lock.id)).toBe(true);
    expect(panelCanAskNext(panelView(lock, scout), false, scout, lock.id)).toBe(true);
    expect(panelCanAskNext(panelView(lock, null), false, null, null)).toBe(false);
  });

  it("waits for detection on a suggested reply and does not trust stale or missing desk state", () => {
    const suggestion = { view: "suggestion" as const, detected: false };
    const scout = { view: "scout" as const, detected: false };
    expect(panelCanAskNext(panelView(lock, suggestion), false, suggestion, lock.id)).toBe(false);
    expect(panelCanAskNext(panelView(lock, suggestion), false, null, null)).toBe(false);
    expect(panelCanAskNext(panelView(lock, suggestion), false, scout, "other-card")).toBe(false);
    expect(panelCanAskNext(panelView(lock, suggestion), true, suggestion, lock.id)).toBe(true);
  });

  it("is always offered on the For You card, like the desk", () => {
    expect(panelCanAskNext(panelView(null, null), false, null, null)).toBe(true);
    expect(nextFromCardId(null)).toEqual({ forYou: true });
    expect(nextFromCardId(lock)).toEqual({ fromCardId: "123" });
  });

  it("is not offered on the Collecting card, which takes the next card by itself", () => {
    const collecting = { view: "collecting" as const, detected: false };
    expect(panelCanAskNext(panelView(null, collecting), false, collecting, null)).toBe(false);
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

describe("shownAfterRefresh", () => {
  const other = { ...lock, id: "456" };

  it("always shows the desk's card when no Next is waiting to be confirmed", () => {
    expect(shownAfterRefresh(null, "t", lock)).toBe(lock);
    expect(shownAfterRefresh(null, "t", null)).toBeNull();
    expect(shownAfterRefresh({ token: "old", request: { fromCardId: "123" }, shown: other }, "t", lock)).toBe(lock);
  });

  it("keeps the preloaded card until the desk has moved off the card Next was pressed on", () => {
    const pending = { token: "t", request: { fromCardId: "123" }, shown: other };
    expect(shownAfterRefresh(pending, "t", lock)).toBe(other);
    expect(shownAfterRefresh(pending, "t", null)).toBeNull();
    const third = { ...lock, id: "789" };
    expect(shownAfterRefresh(pending, "t", third)).toBe(third);
  });

  it("keeps the preloaded card after a For You Next until the desk locks a card", () => {
    const pending = { token: "t", request: { forYou: true as const }, shown: other };
    expect(shownAfterRefresh(pending, "t", null)).toBe(other);
    expect(shownAfterRefresh(pending, "t", lock)).toBe(lock);
  });
});

describe("panelView", () => {
  it("shows the desk's Collecting card when the desk is collecting and no card is locked", () => {
    const view = panelView(null, { view: "collecting", detected: false });
    expect(view).toMatchObject({ collecting: true, key: "collecting" });
    expect(view.card).toMatchObject({ kind: "collecting", verb: "Collecting" });
  });

  it("shows For You or the locked card otherwise, each with its own slide key", () => {
    expect(panelView(null, { view: "for_you", detected: false })).toMatchObject({ collecting: false, key: "for_you" });
    expect(panelView(null, null)).toMatchObject({ collecting: false, key: "for_you" });
    expect(panelView(lock, { view: "collecting", detected: false })).toMatchObject({ collecting: false, key: "card:123" });
  });
});

describe("panelDetected", () => {
  const forYou = (detected: boolean) => ({ view: "for_you" as const, detected });

  it("follows the desk's own For You detection instead of what the panel saw", () => {
    expect(panelDetected({ view: panelView(null, forYou(false)), deskState: forYou(false), deskCardId: null, seenHere: true })).toBe(false);
    expect(panelDetected({ view: panelView(null, forYou(true)), deskState: forYou(true), deskCardId: null, seenHere: false })).toBe(true);
  });

  it("uses what the panel saw when the desk has not published its state", () => {
    expect(panelDetected({ view: panelView(null, null), deskState: null, deskCardId: null, seenHere: true })).toBe(true);
    expect(panelDetected({ view: panelView(lock, null), deskState: null, deskCardId: null, seenHere: false })).toBe(false);
  });

  it("marks a Scout card detected when either the panel or the desk saw the reply", () => {
    const scout = (detected: boolean) => ({ view: "scout" as const, detected });
    expect(panelDetected({ view: panelView(lock, scout(true)), deskState: scout(true), deskCardId: lock.id, seenHere: false })).toBe(true);
    expect(panelDetected({ view: panelView(lock, scout(false)), deskState: scout(false), deskCardId: lock.id, seenHere: true })).toBe(true);
    expect(panelDetected({ view: panelView(lock, scout(false)), deskState: scout(false), deskCardId: lock.id, seenHere: false })).toBe(false);
  });

  it("does not transfer the desk's detection to a preloaded card", () => {
    const scout = { view: "scout" as const, detected: true };
    const preloaded = { ...lock, id: "456" };
    expect(panelDetected({
      view: panelView(preloaded, scout),
      deskState: scout,
      deskCardId: lock.id,
      seenHere: false,
    })).toBe(false);
  });

  it("never marks the Collecting card detected", () => {
    const collecting = { view: "collecting" as const, detected: false };
    expect(panelDetected({ view: panelView(null, collecting), deskState: collecting, deskCardId: null, seenHere: true })).toBe(false);
  });
});

describe("panelCardTarget", () => {
  const scoutView = panelView(lock, { view: "scout", detected: false });
  const base = { view: scoutView, detected: false, deskState: { view: "scout" as const, detected: false }, deskCardId: "123", suggestionId: null };

  it("offers Skip and Not interested on the desk's undetected Scout card", () => {
    expect(panelCardTarget(base)).toEqual({ kind: "scout", card: lock });
  });

  it("offers them on the desk's undetected suggested card only when the suggestion id is known", () => {
    const suggestion = { ...base, deskState: { view: "suggestion" as const, detected: false } };
    expect(panelCardTarget(suggestion)).toBeNull();
    expect(panelCardTarget({ ...suggestion, suggestionId: "s1" })).toEqual({ kind: "suggestion", card: lock, suggestionId: "s1" });
  });

  it("offers nothing once detected, off the desk's card, or on For You, Collecting and other views", () => {
    expect(panelCardTarget({ ...base, detected: true })).toBeNull();
    expect(panelCardTarget({ ...base, deskCardId: "999" })).toBeNull();
    expect(panelCardTarget({ ...base, deskState: { view: "other", detected: false } })).toBeNull();
    expect(panelCardTarget({ ...base, deskState: null })).toBeNull();
    expect(panelCardTarget({ ...base, view: panelView(null, { view: "for_you", detected: false }) })).toBeNull();
    expect(panelCardTarget({ ...base, view: panelView(null, { view: "collecting", detected: false }) })).toBeNull();
  });

  it("addresses the Scout card by its post id and the suggested card by its suggestion id", () => {
    expect(cardActionRequest({ kind: "scout", card: lock }, "skip")).toEqual({ fromCardId: "123", action: "skip", kind: "scout" });
    expect(cardActionRequest({ kind: "suggestion", card: lock, suggestionId: "s1" }, "dismiss")).toEqual({ fromCardId: "s1", action: "dismiss", kind: "suggestion" });
  });

  it("uses the desk's failure notices and confirm copy", () => {
    expect(panelCardActionNotice({ kind: "scout", card: lock }, "skip")).toBe("Could not skip. Try again.");
    expect(panelCardActionNotice({ kind: "scout", card: lock }, "dismiss")).toBe("Could not dismiss. Try again.");
    expect(panelCardActionNotice({ kind: "suggestion", card: lock, suggestionId: "s1" }, "skip")).toBe("Could not update For You. Try again.");
    expect(dismissConfirmCopy(lock)).toBe("Dismiss @dana from Approach. Optional reason is saved to local knowledge memory.");
    expect(dismissConfirmCopy({ ...lock, author: null })).toBe("Dismiss this post from Approach. Optional reason is saved to local knowledge memory.");
  });
});
