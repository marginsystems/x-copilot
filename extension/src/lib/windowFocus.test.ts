import { describe, expect, it, vi } from "vitest";
import { senderWindowFocused } from "./windowFocus";

const xTab = { url: "https://x.com/user/status/1", tab: { windowId: 7 } };

describe("senderWindowFocused", () => {
  it("answers with the focus of the x.com sender's own window", async () => {
    const getWindow = vi.fn((windowId: number) => Promise.resolve({ focused: windowId === 7 }));
    expect(await senderWindowFocused(xTab, getWindow)).toEqual({ focused: true });
    expect(await senderWindowFocused({ ...xTab, tab: { windowId: 8 } }, getWindow)).toEqual({ focused: false });
  });

  it("answers unfocused without a lookup for senders off x.com or without a tab", async () => {
    const getWindow = vi.fn(() => Promise.resolve({ focused: true }));
    expect(await senderWindowFocused({ url: "https://example.com/", tab: { windowId: 7 } }, getWindow)).toEqual({ focused: false });
    expect(await senderWindowFocused({ url: "not a url", tab: { windowId: 7 } }, getWindow)).toEqual({ focused: false });
    expect(await senderWindowFocused({ tab: { windowId: 7 } }, getWindow)).toEqual({ focused: false });
    expect(await senderWindowFocused({ url: xTab.url }, getWindow)).toEqual({ focused: false });
    expect(getWindow).not.toHaveBeenCalled();
  });

  it("answers unfocused when the window lookup fails", async () => {
    expect(await senderWindowFocused(xTab, () => Promise.reject(new Error("gone")))).toEqual({ focused: false });
  });
});
