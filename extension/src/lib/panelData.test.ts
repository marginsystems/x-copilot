import { beforeEach, describe, expect, it, vi } from "vitest";
import { askDeskForNext, recordCardAction } from "./panelData";

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

describe("recordCardAction", () => {
  const card = { id: "1", conversationId: "c1", inReplyToId: null, surface: "reply" as const, author: "@ada", url: "https://x.com/ada/status/1", text: null };

  function sent(): { path: unknown; method: unknown; body: unknown } {
    const [, path, init] = state.apiRequest.mock.lastCall ?? [];
    const options = (init ?? {}) as RequestInit;
    return { path, method: options.method, body: JSON.parse(String(options.body)) };
  }

  beforeEach(() => {
    state.apiRequest.mockReset().mockResolvedValue({ ok: true });
  });

  it("records I posted on X on a suggested card as done, as the desk does", async () => {
    await recordCardAction(pairing, { kind: "suggestion", card: null, suggestionId: "s1" }, "posted");
    expect(sent()).toEqual({ path: "/api/for-you/done", method: "POST", body: { id: "s1" } });
  });

  it("records a Scout Skip with the card fields the panel has, as the desk's Skip does", async () => {
    await recordCardAction(pairing, { kind: "scout", card }, "skip");
    expect(sent()).toEqual({
      path: "/api/skipped",
      method: "POST",
      body: { threadId: "1", author: "@ada", url: "https://x.com/ada/status/1", conversationId: "c1" },
    });
  });

  it("records a Scout Not interested with a trimmed reason, and none when blank", async () => {
    await recordCardAction(pairing, { kind: "scout", card }, "dismiss", "  Off topic ");
    expect(sent()).toMatchObject({ path: "/api/dismissed", body: { threadId: "1", author: "@ada", reason: "Off topic" } });
    await recordCardAction(pairing, { kind: "scout", card }, "dismiss", "   ");
    expect(sent().body).not.toHaveProperty("reason");
  });

  it("records a suggested card through For You by its suggestion id", async () => {
    await recordCardAction(pairing, { kind: "suggestion", card, suggestionId: "s1" }, "skip");
    expect(sent()).toEqual({ path: "/api/for-you/skip", method: "POST", body: { id: "s1" } });
    await recordCardAction(pairing, { kind: "suggestion", card, suggestionId: "s1" }, "dismiss", "ignored");
    expect(sent()).toEqual({ path: "/api/for-you/dismiss", method: "POST", body: { id: "s1" } });
  });

  it("fails when the server refuses, so the panel does not advance", async () => {
    state.apiRequest.mockRejectedValue(new Error("/api/skipped failed (500)"));
    await expect(recordCardAction(pairing, { kind: "scout", card }, "skip")).rejects.toThrow("500");
  });
});
