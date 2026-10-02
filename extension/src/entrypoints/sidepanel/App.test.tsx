import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { readPairing, loadPanelData } = vi.hoisted(() => ({
  readPairing: vi.fn(),
  loadPanelData: vi.fn(),
}));

vi.mock("../../lib/pairingStore", () => ({
  clearPairing: vi.fn(),
  readPairing,
}));

vi.mock("../../lib/panelData", () => ({
  loadPanelData,
  signOutExtension: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    tabs: { create: vi.fn(), query: vi.fn(), update: vi.fn() },
  },
}));

describe("App", () => {
  afterEach(() => {
    readPairing.mockReset();
    loadPanelData.mockReset();
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
});
