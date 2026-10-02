import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportReply } from "./reportReply";

const state = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  readPairing: vi.fn(),
  set: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: { storage: { local: { set: state.set } } },
}));

vi.mock("./pairingStore", () => ({
  readPairing: state.readPairing,
}));

vi.mock("./api", () => ({
  apiRequest: state.apiRequest,
}));

describe("reportReply", () => {
  beforeEach(() => {
    state.apiRequest.mockReset();
    state.readPairing.mockReset();
    state.set.mockReset();
  });

  it("rejects when the extension has no pairing", async () => {
    state.readPairing.mockResolvedValue(null);

    await expect(reportReply("https://x.com/me/status/555", "123")).rejects.toThrow(
      "The extension is not paired",
    );
    expect(state.set).not.toHaveBeenCalled();
  });

  it("keeps a successful report successful when the reply-seen storage write fails", async () => {
    state.readPairing.mockResolvedValue({ apiBase: "https://desk.example", token: "token" });
    state.apiRequest
      .mockResolvedValueOnce({
        ok: true,
        card: {
          id: "123",
          conversationId: null,
          inReplyToId: null,
          surface: "reply",
          author: "@dana",
          url: null,
          text: null,
        },
      })
      .mockResolvedValueOnce({ ok: true });
    state.set.mockRejectedValue(new Error("storage unavailable"));

    await expect(reportReply("https://x.com/me/status/555", "123")).resolves.toBeUndefined();

    expect(state.apiRequest).toHaveBeenNthCalledWith(1, expect.anything(), "/api/scout-approach-lock");
    expect(state.apiRequest).toHaveBeenNthCalledWith(2, expect.anything(), "/api/interacted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "123",
        author: "@dana",
        replyUrl: "https://x.com/me/status/555",
      }),
    });
    expect(state.set).toHaveBeenCalledTimes(1);
  });
});
