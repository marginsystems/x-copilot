import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { readPairing, loadPanelData, askDeskForNext, waitForLockChange, storageData } = vi.hoisted(() => ({
  readPairing: vi.fn(),
  loadPanelData: vi.fn(),
  askDeskForNext: vi.fn(),
  waitForLockChange: vi.fn(),
  storageData: {} as Record<string, unknown>,
}));

vi.mock("../../lib/pairingStore", () => ({
  clearPairing: vi.fn(),
  readPairing,
}));

vi.mock("../../lib/panelData", () => ({
  askDeskForNext,
  loadPanelData,
  signOutExtension: vi.fn(),
}));

vi.mock("../../lib/scoutLock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/scoutLock")>()),
  waitForLockChange,
}));

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storageData[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(storageData, values); }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: { create: vi.fn(), query: vi.fn().mockResolvedValue([]), update: vi.fn() },
  },
}));

HTMLCanvasElement.prototype.getContext = () => null;

const paired = {
  token: "token",
  expiresAt: "2026-11-01T00:00:00.000Z",
  apiBase: "https://api.xcopilot.dev",
  deskOrigin: "https://xcopilot.dev",
};

describe("App", () => {
  afterEach(() => {
    readPairing.mockReset();
    loadPanelData.mockReset();
    askDeskForNext.mockReset();
    waitForLockChange.mockReset();
    for (const key of Object.keys(storageData)) delete storageData[key];
    document.body.replaceChildren();
  });

  it("keeps a valid pairing out of the unpaired state when panel data fails to load", async () => {
    readPairing.mockResolvedValue({
      token: "token",
      expiresAt: "2026-11-01T00:00:00.000Z",
      apiBase: "https://api.xcopilot.dev",
      deskOrigin: "https://xcopilot.dev",
    });
    loadPanelData.mockRejectedValue(new Error("Failed to fetch"));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(readPairing).toHaveBeenCalledOnce();
    expect(loadPanelData).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Your extension is connected");
    expect(container.textContent).not.toContain("Connect this extension to your desk account");

    await act(async () => root.unmount());
  });

  it("shows the For You card and a plain notice when the server is older than the extension", async () => {
    readPairing.mockResolvedValue({
      token: "token",
      expiresAt: "2026-11-01T00:00:00.000Z",
      apiBase: "https://api.xcopilot.dev",
      deskOrigin: "https://xcopilot.dev",
    });
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: false, replyAt: [], scout: null });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("a version behind this extension");
    expect(container.textContent).toContain("Open For You");
    expect(container.textContent).not.toContain("failed (405)");

    await act(async () => root.unmount());
  });

  it("re-arms For You detection after Next before returning to For You", async () => {
    readPairing.mockResolvedValue({
      token: "token",
      expiresAt: "2026-11-01T00:00:00.000Z",
      apiBase: "https://api.xcopilot.dev",
      deskOrigin: "https://xcopilot.dev",
    });
    const now = Date.now();
    storageData.lastReplySeenAt = now - 1_000;
    storageData.panelCardSince = { key: "for_you", sinceMs: now - 5_000 };
    loadPanelData
      .mockResolvedValueOnce({ lock: null, lockSupported: true, replyAt: [], scout: null })
      .mockResolvedValueOnce({ lock: null, lockSupported: true, replyAt: [], scout: null });
    askDeskForNext.mockResolvedValue(true);
    waitForLockChange.mockResolvedValue({
      card: { id: "42", conversationId: null, inReplyToId: null, surface: "reply", author: "@dana", url: null, text: null },
      supported: true,
      valid: true,
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("Post detected");
    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next card");
    expect(next).toBeDefined();
    await act(async () => {
      next?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(storageData.panelCardSince).toMatchObject({ key: "card:42" });
    expect(container.textContent).toContain("Waiting for your reply");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("Waiting for your post");
    expect(container.textContent).not.toContain("Post detected");
    expect(container.textContent).toContain("Open For You");
    await act(async () => root.unmount());
  });

  it("keeps the reading timer toggle behind the settings gear", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, replyAt: [], scout: null });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(container.querySelector("input[type=checkbox]")).toBeNull();
    expect(container.textContent).not.toContain("Reading timer");
    const gear = container.querySelector<HTMLButtonElement>("button[aria-label=Settings]");
    expect(gear?.querySelector("svg")).not.toBeNull();

    await act(async () => gear?.click());
    const toggle = container.querySelector<HTMLInputElement>("input[type=checkbox]");
    expect(container.textContent).toContain("Reading timer on posts");
    expect(container.textContent).toContain("Sign out");
    expect(toggle?.checked).toBe(true);

    await act(async () => toggle?.click());
    expect(storageData.attentionGate).toBe(false);

    const done = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Done");
    await act(async () => done?.click());
    expect(container.querySelector("input[type=checkbox]")).toBeNull();
    expect(container.textContent).toContain("Open For You");

    await act(async () => root.unmount());
  });

  it("shows Scout with today's replies, streak and level under the card", async () => {
    readPairing.mockResolvedValue(paired);
    const today = new Date().toISOString().slice(0, 10);
    const replies = Array.from({ length: 4 }, (_, index) => `${today}T0${index}:00:00.000Z`);
    for (const replyAt of replies) {
      loadPanelData.mockResolvedValueOnce({
        lock: null,
        lockSupported: true,
        replyAt: [replyAt],
        scout: { level: 4, streak: 5 },
      });
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    for (let index = 1; index < replies.length; index += 1) {
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      });
    }

    const scout = container.querySelector("section[aria-label=Scout]");
    expect(scout?.querySelector("canvas")).not.toBeNull();
    expect(scout?.textContent).toContain("4 replies today. Scout is glowing.");
    expect(Array.from(scout?.querySelectorAll("dd") ?? []).map((node) => node.textContent)).toEqual(["4", "5d", "4"]);

    await act(async () => root.unmount());
  });

  it("shows the preloaded next card at once, before the desk answers", async () => {
    readPairing.mockResolvedValue(paired);
    const upNext = { id: "42", conversationId: null, inReplyToId: null, surface: "reply", author: "@dana", url: null, text: "Preloaded post" };
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, nextUp: { card: upNext }, replyAt: [], scout: null });
    askDeskForNext.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next card");
    await act(async () => {
      next?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("@dana");
    expect(container.textContent).toContain("Preloaded post");
    expect(container.textContent).not.toContain("Finding next");
    expect(waitForLockChange).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Preloaded post");

    await act(async () => root.unmount());
  });

  it("goes back to the desk's card with a notice when no desk is open to confirm the preloaded one", async () => {
    readPairing.mockResolvedValue(paired);
    const upNext = { id: "42", conversationId: null, inReplyToId: null, surface: "reply", author: "@dana", url: null, text: "Preloaded post" };
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, nextUp: { card: upNext }, replyAt: [], scout: null });
    askDeskForNext.mockResolvedValue(false);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next card");
    await act(async () => {
      next?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(container.textContent).not.toContain("Preloaded post");
    expect(container.textContent).toContain("Open For You");
    expect(container.textContent).toContain("Open your desk dashboard in a tab");

    await act(async () => root.unmount());
  });
});
