import { describe, expect, it } from "vitest";
import { X_FOR_YOU_URL } from "../../../shared/src/forYou";
import { REPLY_PACE_MS } from "../../../shared/src/replyPace";
import { panelCard, panelPace, scoutOpenUrl } from "./panelModel";

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
    expect(panelCard(null)).toMatchObject({ kind: "for_you", openUrl: X_FOR_YOU_URL });
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
