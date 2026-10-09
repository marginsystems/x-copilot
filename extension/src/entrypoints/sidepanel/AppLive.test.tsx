import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { readPairing, loadPanelData, watchLock, stopWatching, storageData } = vi.hoisted(() => ({
  readPairing: vi.fn(),
  loadPanelData: vi.fn(),
  watchLock: vi.fn(),
  stopWatching: vi.fn(),
  storageData: {} as Record<string, unknown>,
}));

vi.mock("../../lib/pairingStore", () => ({
  clearPairing: vi.fn(),
  readPairing,
}));

vi.mock("../../lib/panelData", () => ({
  askDeskForNext: vi.fn(),
  loadPanelData,
  signOutExtension: vi.fn(),
}));

vi.mock("../../lib/lockStream", () => ({ watchLock }));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storageData[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(storageData, values); }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      create: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  },
}));

HTMLCanvasElement.prototype.getContext = () => null;

const paired = {
  token: "token",
  expiresAt: "2026-11-01T00:00:00.000Z",
  apiBase: "https://api.xcopilot.dev",
  deskOrigin: "https://xcopilot.dev",
};

const card = (id: string, author: string) => ({
  id,
  conversationId: null,
  inReplyToId: null,
  surface: "reply" as const,
  author,
  url: `https://x.com/${author.slice(1)}/status/${id}`,
  text: `post by ${author}`,
});

const settle = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

describe("App live card", () => {
  afterEach(() => {
    readPairing.mockReset();
    loadPanelData.mockReset();
    watchLock.mockReset();
    stopWatching.mockReset();
    for (const key of Object.keys(storageData)) delete storageData[key];
    document.body.replaceChildren();
  });

  it("shows the desk's new card as soon as the lock stream reports a change", async () => {
    readPairing.mockResolvedValue(paired);
    watchLock.mockReturnValue(stopWatching);
    loadPanelData
      .mockResolvedValueOnce({ lock: card("1", "@dana"), lockSupported: true, replyAt: [], scout: null })
      .mockResolvedValue({ lock: card("2", "@erin"), lockSupported: true, replyAt: [], scout: null });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await settle();
    });
    expect(container.textContent).toContain("@dana");
    expect(watchLock).toHaveBeenCalledOnce();
    expect(watchLock.mock.calls[0]?.[0]).toEqual({ apiBase: paired.apiBase, token: paired.token });

    const lockChanged = watchLock.mock.calls[0]?.[1] as () => void;
    await act(async () => {
      lockChanged();
      await settle();
    });
    const shown = container.querySelector(".card-slide-item:not(.is-leaving)");
    expect(shown?.textContent).toContain("@erin");
    expect(shown?.textContent).not.toContain("@dana");
    expect(watchLock).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    expect(stopWatching).toHaveBeenCalledOnce();
  });

  it("does not open a lock stream while the extension is not connected", async () => {
    readPairing.mockResolvedValue(null);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await settle();
    });
    expect(watchLock).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });
});
