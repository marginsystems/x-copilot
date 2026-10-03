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
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: false, replyAt: [] });
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
      .mockResolvedValueOnce({ lock: null, lockSupported: true, replyAt: [] })
      .mockResolvedValueOnce({ lock: null, lockSupported: true, replyAt: [] });
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
});
