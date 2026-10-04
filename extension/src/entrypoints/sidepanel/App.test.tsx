import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { readPairing, loadPanelData, askDeskForNext, waitForLockChange, tabsQuery, tabsCreate, storageData } = vi.hoisted(() => ({
  readPairing: vi.fn(),
  loadPanelData: vi.fn(),
  askDeskForNext: vi.fn(),
  waitForLockChange: vi.fn(),
  tabsQuery: vi.fn().mockResolvedValue([]),
  tabsCreate: vi.fn(),
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

vi.mock("../../lib/lockStream", () => ({ watchLock: () => () => undefined }));

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storageData[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(storageData, values); }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: { create: tabsCreate, query: tabsQuery, update: vi.fn() },
  },
}));

HTMLCanvasElement.prototype.getContext = () => null;

function shownCard(container: HTMLElement): Element | null {
  return container.querySelector(".card-slide-item:not(.is-leaving)");
}

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
    tabsQuery.mockReset().mockResolvedValue([]);
    tabsCreate.mockReset();
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
    expect(shownCard(container)?.textContent).toContain("Waiting for your reply");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(shownCard(container)?.textContent).toContain("Waiting for your post");
    expect(shownCard(container)?.textContent).not.toContain("Post detected");
    expect(shownCard(container)?.textContent).toContain("Open For You");
    await act(async () => root.unmount());
  });

  it("follows the desk to its new card with a slide, without opening a tab", async () => {
    readPairing.mockResolvedValue(paired);
    const first = { id: "1", conversationId: null, inReplyToId: null, surface: "reply", author: "@ada", url: null, text: "First post" };
    const second = { ...first, id: "2", author: "@bob", text: "Second post" };
    loadPanelData
      .mockResolvedValueOnce({ lock: first, lockSupported: true, replyAt: [], scout: null })
      .mockResolvedValue({ lock: second, lockSupported: true, replyAt: [], scout: null });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(shownCard(container)?.textContent).toContain("First post");
    expect(container.querySelector(".is-leaving")).toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(askDeskForNext).not.toHaveBeenCalled();
    expect(tabsCreate).not.toHaveBeenCalled();
    expect(shownCard(container)?.textContent).toContain("Second post");
    expect(shownCard(container)?.className).toContain("is-entering");
    const leaving = container.querySelector(".is-leaving");
    expect(leaving?.textContent).toContain("First post");
    expect(leaving?.hasAttribute("aria-hidden")).toBe(true);
    expect(leaving?.hasAttribute("inert")).toBe(true);

    await act(async () => root.unmount());
  });

  it.each(["previous card", "cleared lock"])("does not let a refresh started before Next restore the server lock after a %s response", async (staleLock) => {
    readPairing.mockResolvedValue(paired);
    storageData.lastRepliedCardId = "1";
    const first = { id: "1", conversationId: null, inReplyToId: null, surface: "reply", author: "@ada", url: null, text: "First post" };
    const second = { ...first, id: "2", author: "@bob", text: "Second post" };
    let resolveRefresh!: (data: { lock: typeof first | null; lockSupported: boolean; replyAt: never[]; scout: null }) => void;
    loadPanelData
      .mockResolvedValueOnce({ lock: first, lockSupported: true, replyAt: [], scout: null })
      .mockReturnValueOnce(new Promise((resolve) => { resolveRefresh = resolve; }));
    askDeskForNext.mockResolvedValue(true);
    waitForLockChange.mockResolvedValue({ card: second, supported: true, valid: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(loadPanelData).toHaveBeenCalledTimes(2);

    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next card");
    await act(async () => {
      next?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(shownCard(container)?.textContent).toContain("Second post");

    await act(async () => {
      resolveRefresh({ lock: staleLock === "cleared lock" ? null : first, lockSupported: true, replyAt: [], scout: null });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(shownCard(container)?.textContent).toContain("Second post");
    expect(Array.from(shownCard(container)?.querySelectorAll("button") ?? []).some((button) => button.textContent === "Next card")).toBe(false);

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
    askDeskForNext.mockResolvedValue(true);
    waitForLockChange.mockReturnValue(new Promise(() => undefined));
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

    expect(shownCard(container)?.textContent).toContain("@dana");
    expect(shownCard(container)?.textContent).toContain("Preloaded post");
    expect(waitForLockChange).toHaveBeenCalledOnce();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(shownCard(container)?.textContent).toContain("Preloaded post");

    await act(async () => root.unmount());
  });

  it("returns to the desk's card with a notice when the desk never confirms a preloaded Next", async () => {
    readPairing.mockResolvedValue(paired);
    storageData.lastRepliedCardId = "1";
    const current = { id: "1", conversationId: null, inReplyToId: null, surface: "reply", author: "@ada", url: null, text: "Current post" };
    const preloaded = { ...current, id: "2", author: "@dana", text: "Preloaded post" };
    loadPanelData.mockResolvedValue({ lock: current, lockSupported: true, nextUp: { card: preloaded }, replyAt: [], scout: null });
    askDeskForNext.mockResolvedValue(true);
    let giveUp!: (value: null) => void;
    waitForLockChange.mockReturnValue(new Promise<null>((resolve) => { giveUp = resolve; }));
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
    expect(shownCard(container)?.textContent).toContain("Preloaded post");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(shownCard(container)?.textContent).toContain("Preloaded post");

    await act(async () => {
      giveUp(null);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(shownCard(container)?.textContent).toContain("@ada");
    expect(shownCard(container)?.textContent).not.toContain("Preloaded post");
    expect(shownCard(container)?.textContent).toContain("as soon as its dashboard is showing");
    expect(tabsCreate).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });

  it("does not show the desk's detection on a preloaded next card", async () => {
    readPairing.mockResolvedValue(paired);
    storageData.lastRepliedCardId = "another-card";
    const current = { id: "1", conversationId: null, inReplyToId: null, surface: "reply", author: "@ada", url: null, text: "Current post" };
    const preloaded = { ...current, id: "2", author: "@dana", text: "Preloaded post" };
    loadPanelData.mockResolvedValue({
      lock: current,
      lockSupported: true,
      nextUp: { card: preloaded },
      deskState: { view: "scout", detected: true },
      replyAt: [],
      scout: null,
    });
    askDeskForNext.mockResolvedValue(true);
    let confirmNext!: (value: { card: typeof preloaded; state: { view: "scout"; detected: false }; supported: true; valid: true }) => void;
    waitForLockChange.mockReturnValue(new Promise((resolve) => { confirmNext = resolve; }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(shownCard(container)?.textContent).toContain("Reply detected");

    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next card");
    await act(async () => {
      next?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(shownCard(container)?.textContent).toContain("Preloaded post");
    expect(shownCard(container)?.textContent).not.toContain("Reply detected");
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Open post on X")).toBe(true);

    await act(async () => {
      confirmNext({ card: preloaded, state: { view: "scout", detected: false }, supported: true, valid: true });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => root.unmount());
  });

  it("opens the preloaded card before waiting for and opening the confirmed card", async () => {
    readPairing.mockResolvedValue(paired);
    const preloaded = { id: "42", conversationId: null, inReplyToId: null, surface: "reply", author: "@dana", url: null, text: "Preloaded post" };
    const confirmed = { ...preloaded, id: "43", author: "@lee", text: "Confirmed post" };
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, nextUp: { card: preloaded }, replyAt: [], scout: null });
    askDeskForNext.mockResolvedValue(true);
    waitForLockChange.mockResolvedValue({ card: confirmed, supported: true, valid: true });
    let resolveTabs!: (tabs: never[]) => void;
    tabsQuery.mockReturnValueOnce(new Promise<never[]>((resolve) => { resolveTabs = resolve; }));
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

    expect(waitForLockChange).not.toHaveBeenCalled();
    expect(shownCard(container)?.textContent).toContain("Preloaded post");

    await act(async () => {
      resolveTabs([]);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(waitForLockChange).toHaveBeenCalledOnce();
    expect(tabsCreate).toHaveBeenNthCalledWith(1, { url: "https://x.com/i/status/42", active: true });
    expect(tabsCreate).toHaveBeenNthCalledWith(2, { url: "https://x.com/i/status/43", active: true });
    expect(shownCard(container)?.textContent).toContain("Confirmed post");

    await act(async () => root.unmount());
  });

  it("stays on its card with a notice when no desk is open to take the Next", async () => {
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
    expect(container.querySelector(".is-leaving")).toBeNull();
    expect(container.textContent).toContain("Open For You");
    expect(container.textContent).toContain("Open your desk dashboard in a tab");

    await act(async () => root.unmount());
  });

  it("shows the desk's own For You detection and its Collecting card, then the card Scout finds", async () => {
    readPairing.mockResolvedValue(paired);
    const now = Date.now();
    storageData.lastReplySeenAt = now - 1_000;
    storageData.panelCardSince = { key: "for_you", sinceMs: now - 5_000 };
    const found = { id: "77", conversationId: null, inReplyToId: null, surface: "reply", author: "@eve", url: null, text: "Fresh from Scout" };
    const collecting = { view: "collecting", detected: false };
    loadPanelData
      .mockResolvedValueOnce({ lock: null, lockSupported: true, deskState: { view: "for_you", detected: false }, replyAt: [], scout: null })
      .mockResolvedValueOnce({ lock: null, lockSupported: true, deskState: collecting, replyAt: [], scout: null })
      .mockResolvedValue({ lock: found, lockSupported: true, deskState: { view: "scout", detected: false }, replyAt: [], scout: null });
    askDeskForNext.mockResolvedValue(true);
    waitForLockChange.mockResolvedValue({ card: null, next: null, state: collecting, supported: true, valid: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(shownCard(container)?.textContent).toContain("Waiting for your post");
    expect(shownCard(container)?.textContent).not.toContain("Post detected");

    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next card");
    await act(async () => {
      next?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(shownCard(container)?.textContent).toContain("Scout is collecting posts");
    expect(shownCard(container)?.textContent).toContain("Waiting for Scout");
    expect(shownCard(container)?.textContent).not.toContain("Next card");
    expect(container.textContent).not.toContain("No new card yet");
    expect(tabsCreate).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(shownCard(container)?.textContent).toContain("Scout is collecting posts");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(shownCard(container)?.textContent).toContain("Fresh from Scout");

    await act(async () => root.unmount());
  });
});
