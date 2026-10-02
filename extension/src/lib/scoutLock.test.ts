import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiStatusError } from "./api";
import { readScoutLock } from "./scoutLock";

const state = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  apiRequest: state.apiRequest,
}));

const pairing = { token: "t", expiresAt: "2099-01-01T00:00:00.000Z", apiBase: "https://api.xcopilot.dev", deskOrigin: "https://xcopilot.dev" };
const card = { id: "1", conversationId: null, inReplyToId: null, surface: "reply", author: "@dana", url: null, text: null };

describe("readScoutLock", () => {
  beforeEach(() => {
    state.apiRequest.mockReset();
  });

  it("reads the locked card from a current server", async () => {
    state.apiRequest.mockResolvedValue({ ok: true, card });
    await expect(readScoutLock(pairing)).resolves.toEqual({ card, supported: true });
  });

  it.each([404, 405])("treats %i from an older server as no Scout lock", async (status) => {
    state.apiRequest.mockRejectedValue(new ApiStatusError("/api/scout-approach-lock", status));
    await expect(readScoutLock(pairing)).resolves.toEqual({ card: null, supported: false });
  });

  it("still fails on server errors and degrades malformed answers to no lock", async () => {
    state.apiRequest.mockRejectedValueOnce(new ApiStatusError("/api/scout-approach-lock", 500));
    await expect(readScoutLock(pairing)).rejects.toThrow("failed (500)");
    state.apiRequest.mockResolvedValueOnce({ ok: true, card: { id: "" } });
    await expect(readScoutLock(pairing)).resolves.toEqual({ card: null, supported: true });
  });
});
