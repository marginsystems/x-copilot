import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiStatusError } from "./api";
import { NEXT_POLL_TRIES, readScoutLock, waitForLockChange } from "./scoutLock";

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
    await expect(readScoutLock(pairing)).resolves.toEqual({ card, supported: true, valid: true });
  });

  it.each([404, 405])("treats %i from an older server as no Scout lock", async (status) => {
    state.apiRequest.mockRejectedValue(new ApiStatusError("/api/scout-approach-lock", status));
    await expect(readScoutLock(pairing)).resolves.toEqual({ card: null, supported: false, valid: false });
  });

  it("still fails on server errors and degrades malformed answers to no lock", async () => {
    state.apiRequest.mockRejectedValueOnce(new ApiStatusError("/api/scout-approach-lock", 500));
    await expect(readScoutLock(pairing)).rejects.toThrow("failed (500)");
    state.apiRequest.mockResolvedValueOnce({ ok: true, card: { id: "" } });
    await expect(readScoutLock(pairing)).resolves.toEqual({ card: null, supported: true, valid: false });
  });
});

describe("waitForLockChange", () => {
  beforeEach(() => {
    state.apiRequest.mockReset();
  });

  const other = { ...card, id: "2" };
  const noSleep = () => Promise.resolve();

  it("returns the new lock as soon as the desk moves on", async () => {
    state.apiRequest
      .mockResolvedValueOnce({ ok: true, card })
      .mockResolvedValueOnce({ ok: true, card: other });
    await expect(waitForLockChange(pairing, "1", noSleep)).resolves.toEqual({ card: other, supported: true, valid: true });
    expect(state.apiRequest).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      kind: "unsupported",
      firstRead: () => state.apiRequest.mockRejectedValueOnce(new ApiStatusError("/api/scout-approach-lock", 404)),
    },
    {
      kind: "malformed",
      firstRead: () => state.apiRequest.mockResolvedValueOnce({ ok: true, card: { id: "" } }),
    },
  ])("continues polling after a $kind lock read", async ({ firstRead }) => {
    firstRead();
    state.apiRequest.mockResolvedValueOnce({ ok: true, card: other });
    await expect(waitForLockChange(pairing, "1", noSleep)).resolves.toEqual({ card: other, supported: true, valid: true });
    expect(state.apiRequest).toHaveBeenCalledTimes(2);
  });

  it("treats a cleared lock as moved, to For You", async () => {
    state.apiRequest.mockResolvedValue({ ok: true, card: null });
    await expect(waitForLockChange(pairing, "1", noSleep)).resolves.toEqual({ card: null, supported: true, valid: true });
  });

  it("gives up after a bounded number of checks when the desk does not move", async () => {
    state.apiRequest.mockResolvedValue({ ok: true, card });
    await expect(waitForLockChange(pairing, "1", noSleep)).resolves.toBeNull();
    expect(state.apiRequest).toHaveBeenCalledTimes(NEXT_POLL_TRIES);
  });
});
