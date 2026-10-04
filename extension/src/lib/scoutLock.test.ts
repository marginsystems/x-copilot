import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiStatusError } from "./api";
import { NEXT_POLL_FAST_MS, NEXT_POLL_MS, NEXT_POLL_TRIES, readScoutLock, waitForLockChange } from "./scoutLock";

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
    await expect(readScoutLock(pairing)).resolves.toEqual({ card, next: null, state: null, supported: true, valid: true });
  });

  it("reads the card the desk has lined up after Next", async () => {
    const upNext = { ...card, id: "2" };
    state.apiRequest.mockResolvedValue({ ok: true, card, next: { card: upNext } });
    await expect(readScoutLock(pairing)).resolves.toMatchObject({ card, next: { card: upNext } });
  });

  it.each([404, 405])("treats %i from an older server as no Scout lock", async (status) => {
    state.apiRequest.mockRejectedValue(new ApiStatusError("/api/scout-approach-lock", status));
    await expect(readScoutLock(pairing)).resolves.toEqual({ card: null, next: null, state: null, supported: false, valid: false });
  });

  it("still fails on server errors and degrades malformed answers to no lock", async () => {
    state.apiRequest.mockRejectedValueOnce(new ApiStatusError("/api/scout-approach-lock", 500));
    await expect(readScoutLock(pairing)).rejects.toThrow("failed (500)");
    state.apiRequest.mockResolvedValueOnce({ ok: true, card: { id: "" } });
    await expect(readScoutLock(pairing)).resolves.toEqual({ card: null, next: null, state: null, supported: true, valid: false });
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
    await expect(waitForLockChange(pairing, { fromCardId: "1" }, noSleep)).resolves.toEqual({ card: other, next: null, state: null, supported: true, valid: true });
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
    await expect(waitForLockChange(pairing, { fromCardId: "1" }, noSleep)).resolves.toEqual({ card: other, next: null, state: null, supported: true, valid: true });
    expect(state.apiRequest).toHaveBeenCalledTimes(2);
  });

  it("treats a cleared lock as moved, to For You", async () => {
    state.apiRequest.mockResolvedValue({ ok: true, card: null });
    await expect(waitForLockChange(pairing, { fromCardId: "1" }, noSleep)).resolves.toEqual({ card: null, next: null, state: null, supported: true, valid: true });
  });

  it("after a For You Next, waits for a card to appear", async () => {
    state.apiRequest
      .mockResolvedValueOnce({ ok: true, card: null })
      .mockResolvedValueOnce({ ok: true, card });
    await expect(waitForLockChange(pairing, { forYou: true }, noSleep)).resolves.toMatchObject({ card, supported: true });
    state.apiRequest.mockReset();
    state.apiRequest.mockResolvedValue({ ok: true, card: null });
    await expect(waitForLockChange(pairing, { forYou: true }, noSleep)).resolves.toBeNull();
  });

  it("gives up after a bounded number of checks when the desk does not move", async () => {
    state.apiRequest.mockResolvedValue({ ok: true, card });
    await expect(waitForLockChange(pairing, { fromCardId: "1" }, noSleep)).resolves.toBeNull();
    expect(state.apiRequest).toHaveBeenCalledTimes(NEXT_POLL_TRIES);
  });

  it("checks quickly right after Next, then settles to the slower pace", async () => {
    state.apiRequest.mockResolvedValue({ ok: true, card });
    const waits: number[] = [];
    await waitForLockChange(pairing, { fromCardId: "1" }, async (ms) => { waits.push(ms); });
    expect(waits[0]).toBe(NEXT_POLL_FAST_MS);
    expect(waits.at(-1)).toBe(NEXT_POLL_MS);
    expect(NEXT_POLL_FAST_MS).toBeLessThan(NEXT_POLL_MS);
  });

  it("after a For You Next, counts the desk moving to its Collecting card as moved", async () => {
    state.apiRequest
      .mockResolvedValueOnce({ ok: true, card: null, state: { view: "for_you", detected: true } })
      .mockResolvedValueOnce({ ok: true, card: null, state: { view: "collecting", detected: false } });
    await expect(waitForLockChange(pairing, { forYou: true }, noSleep)).resolves.toMatchObject({
      card: null,
      state: { view: "collecting", detected: false },
    });
    expect(state.apiRequest).toHaveBeenCalledTimes(2);
  });
});
