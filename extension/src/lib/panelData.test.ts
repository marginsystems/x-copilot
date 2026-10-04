import { beforeEach, describe, expect, it, vi } from "vitest";
import { askDeskForNext } from "./panelData";

const state = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  apiRequest: state.apiRequest,
}));

const pairing = { token: "t", expiresAt: "2099-01-01T00:00:00.000Z", apiBase: "https://api.xcopilot.dev", deskOrigin: "https://xcopilot.dev" };

describe("askDeskForNext", () => {
  beforeEach(() => {
    state.apiRequest.mockReset();
  });

  it("names the server as the one that moved the card, even when a desk was also told", async () => {
    state.apiRequest.mockResolvedValue({ ok: true, delivered: true, advanced: true });
    await expect(askDeskForNext(pairing, { forYou: true })).resolves.toBe("server");
    state.apiRequest.mockResolvedValue({ ok: true, delivered: false, advanced: true });
    await expect(askDeskForNext(pairing, { forYou: true })).resolves.toBe("server");
  });

  it("names the desk when the server handed the Next to an open desk", async () => {
    state.apiRequest.mockResolvedValue({ ok: true, delivered: true, advanced: false });
    await expect(askDeskForNext(pairing, { fromCardId: "1" })).resolves.toBe("desk");
    state.apiRequest.mockResolvedValue({ ok: true, delivered: true });
    await expect(askDeskForNext(pairing, { fromCardId: "1" })).resolves.toBe("desk");
  });

  it("names nobody when neither could take it, and rejects a malformed answer", async () => {
    state.apiRequest.mockResolvedValue({ ok: true, delivered: false, advanced: false });
    await expect(askDeskForNext(pairing, { fromCardId: "1" })).resolves.toBeNull();
    state.apiRequest.mockResolvedValue({ ok: true });
    await expect(askDeskForNext(pairing, { fromCardId: "1" })).rejects.toThrow("malformed");
  });
});
