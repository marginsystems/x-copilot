import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportReply } from "./reportReply";

const state = vi.hoisted(() => ({
  readPairing: vi.fn(),
  set: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: { storage: { local: { set: state.set } } },
}));

vi.mock("./pairingStore", () => ({
  readPairing: state.readPairing,
}));

describe("reportReply", () => {
  beforeEach(() => {
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
});
