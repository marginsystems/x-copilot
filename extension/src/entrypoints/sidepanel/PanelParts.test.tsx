import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { readPairing, create, query, update, focusWindow } = vi.hoisted(() => ({
  readPairing: vi.fn(),
  create: vi.fn(),
  query: vi.fn(),
  update: vi.fn(),
  focusWindow: vi.fn(),
}));

vi.mock("../../lib/pairingStore", () => ({ clearPairing: vi.fn(), readPairing }));
vi.mock("../../lib/panelData", () => ({ loadPanelData: vi.fn(), signOutExtension: vi.fn() }));
vi.mock("wxt/browser", () => ({
  browser: {
    storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    tabs: { create, query, update },
    windows: { update: focusWindow },
  },
}));

HTMLCanvasElement.prototype.getContext = () => null;

describe("unpaired panel", () => {
  afterEach(() => {
    readPairing.mockReset();
    create.mockReset();
    query.mockReset();
    update.mockReset();
    focusWindow.mockReset();
    document.body.replaceChildren();
  });

  it("shows only the connection status in its header, plus connect steps and desk links", async () => {
    readPairing.mockResolvedValue(null);
    create.mockResolvedValue(undefined);
    query.mockResolvedValue([]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(container.textContent).toContain("Not connected");
    expect(container.querySelector(".panel-head")?.textContent).toBe("Not connected");
    expect(container.querySelector("section[aria-label=Scout]")?.textContent).toContain("Scout is napping");
    expect(buttons.map((button) => button.textContent)).toEqual(
      expect.arrayContaining(["Open Account", "Open desk", "Learn"]),
    );

    const learn = buttons.find((button) => button.textContent === "Learn");
    await act(async () => learn?.click());
    expect(create).toHaveBeenCalledWith({ url: "https://xcopilot.dev/learn" });

    await act(async () => root.unmount());
  });

  it("takes an open desk tab to Account instead of opening a new tab", async () => {
    readPairing.mockResolvedValue(null);
    query.mockImplementation(async (filter: { currentWindow?: boolean }) =>
      filter.currentWindow
        ? [{ id: 1, url: "https://x.com/home", windowId: 7 }]
        : [{ id: 1, url: "https://x.com/home", windowId: 7 }, { id: 9, url: "https://xcopilot.dev/dashboard", windowId: 8 }]);
    update.mockResolvedValue(undefined);
    focusWindow.mockResolvedValue(undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    const openAccount = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Open Account");
    await act(async () => {
      openAccount?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(9, { url: "https://xcopilot.dev/account", active: true });
    expect(focusWindow).toHaveBeenCalledWith(8, { focused: true });

    await act(async () => root.unmount());
  });
});
