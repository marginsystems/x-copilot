import { describe, expect, it } from "vitest";
import { postedStatusUrl, replyReport, seenPostBody } from "./replySeen";

const lock = {
  id: "100",
  conversationId: "90",
  inReplyToId: null,
  surface: "reply" as const,
  author: "@dana",
  url: "https://x.com/dana/status/100",
  text: "A post worth reading",
};

describe("postedStatusUrl", () => {
  it("normalises the toast's View link to a status URL", () => {
    expect(postedStatusUrl("/me/status/555")).toBe("https://x.com/me/status/555");
    expect(postedStatusUrl("https://x.com/me/status/555/analytics")).toBe("https://x.com/me/status/555");
  });

  it("ignores anything that is not an x.com status", () => {
    expect(postedStatusUrl("/me")).toBeNull();
    expect(postedStatusUrl("https://evil.example/me/status/555")).toBeNull();
    expect(postedStatusUrl(null)).toBeNull();
  });
});

describe("seenPostBody", () => {
  it("reports every post with its id and the status page it was written on", () => {
    expect(seenPostBody("https://x.com/me/status/555", "100")).toEqual({
      postId: "555",
      url: "https://x.com/me/status/555",
      pageStatusId: "100",
    });
  });

  it("leaves the page out for a post written off a status page or on its own page", () => {
    expect(seenPostBody("/me/status/555", null)).toEqual({ postId: "555", url: "https://x.com/me/status/555" });
    expect(seenPostBody("/me/status/555", "555")).toEqual({ postId: "555", url: "https://x.com/me/status/555" });
  });

  it("reports nothing for a link that is not an x.com status", () => {
    expect(seenPostBody("https://evil.example/me/status/555", "100")).toBeNull();
  });
});

describe("replyReport", () => {
  it("marks the locked Scout post when the reply was written on it", () => {
    expect(replyReport(lock, "100", "https://x.com/me/status/555")).toEqual({
      kind: "scout",
      body: {
        threadId: "100",
        author: "@dana",
        replyUrl: "https://x.com/me/status/555",
        url: "https://x.com/dana/status/100",
        text: "A post worth reading",
        conversationId: "90",
      },
    });
    expect(replyReport(lock, "90", "https://x.com/me/status/555").kind).toBe("scout");
  });

  it("asks the server to catch up anywhere else", () => {
    expect(replyReport(lock, "777", "https://x.com/me/status/555")).toEqual({ kind: "catch_up" });
    expect(replyReport(lock, null, "https://x.com/me/status/555")).toEqual({ kind: "catch_up" });
    expect(replyReport(null, "100", "https://x.com/me/status/555")).toEqual({ kind: "catch_up" });
    expect(replyReport({ ...lock, author: null }, "100", "https://x.com/me/status/555")).toEqual({ kind: "catch_up" });
  });
});
