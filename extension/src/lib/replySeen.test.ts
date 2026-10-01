import { describe, expect, it } from "vitest";
import { postedStatusUrl, replyReport } from "./replySeen";

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
