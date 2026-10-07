import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { readPairing, loadPanelData, askDeskForNext, recordCardAction, waitForLockChange, tabsQuery, tabsCreate, storageData } = vi.hoisted(() => ({
  readPairing: vi.fn(),
  loadPanelData: vi.fn(),
  askDeskForNext: vi.fn(),
  recordCardAction: vi.fn(),
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
  recordCardAction,
  signOutExtension: vi.fn(),
}));

vi.mock("../../lib/scoutLock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/scoutLock")>()),
  waitForLockChange,
}));

vi.mock("../../lib/lockStream", () => ({ watchLock: () => () => undefined }));

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
    tabs: { create: tabsCreate, query: tabsQuery, update: vi.fn() },
  },
}));

HTMLCanvasElement.prototype.getContext = () => null;

function shownCard(container: HTMLElement): Element | null {
  return container.querySelector(".card-slide-item:not(.is-leaving)");
}

function buttonLabelled(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((button) => button.textContent === label);
}

const paired = {
  token: "token",
  expiresAt: "2026-11-01T00:00:00.000Z",
  apiBase: "https://api.xcopilot.dev",
  deskOrigin: "https://xcopilot.dev",
};

describe("App", () => {
  afterEach(() => {
    vi.useRealTimers();
    readPairing.mockReset();
    loadPanelData.mockReset();
    askDeskForNext.mockReset();
    recordCardAction.mockReset();
    waitForLockChange.mockReset();
    tabsQuery.mockReset().mockResolvedValue([]);
    tabsCreate.mockReset();
    for (const key of Object.keys(storageData)) delete storageData[key];
    document.body.replaceChildren();
  });

  async function mountPanel() {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    return { container, root };
  }

  async function press(container: HTMLElement, label: string) {
    await act(async () => {
      buttonLabelled(container, label)?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
  }

  it("fills Next and leaves every Open button hollow", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, replyAt: [], repliesToday: null, scout: null });
    const { container, root } = await mountPanel();

    expect(buttonLabelled(container, "Open For You")?.className).toBe("ghost");
    expect(buttonLabelled(container, "Open Inspiration")?.className).toBe("ghost");
    expect(buttonLabelled(container, "Next")?.className).toBe("primary");
    await act(async () => root.unmount());
  });

  it("asks before skipping a For You card whose post is not detected", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, replyAt: [], repliesToday: null, scout: null });
    askDeskForNext.mockResolvedValue(true);
    waitForLockChange.mockResolvedValue(null);
    const { container, root } = await mountPanel();

    await press(container, "Next");

    expect(askDeskForNext).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No post detected yet. Skip this card?");
    expect(buttonLabelled(container, "Skip card")?.className).toBe("primary");
    expect(buttonLabelled(container, "Keep waiting")?.className).toBe("ghost");
    expect(buttonLabelled(container, "Open For You")).toBeUndefined();
    expect(buttonLabelled(container, "Next")).toBeUndefined();
    expect(document.activeElement).toBe(buttonLabelled(container, "Keep waiting"));

    await press(container, "Keep waiting");

    expect(askDeskForNext).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Skip this card?");
    expect(buttonLabelled(container, "Open For You")).toBeDefined();
    expect(document.activeElement).toBe(buttonLabelled(container, "Next"));

    await press(container, "Next");
    await press(container, "Skip card");

    expect(askDeskForNext).toHaveBeenCalledTimes(1);
    expect(askDeskForNext).toHaveBeenCalledWith(expect.anything(), { forYou: true });
    await act(async () => root.unmount());
  });

  it("asks before skipping a Scout card whose reply is not detected, then sends the Next", async () => {
    readPairing.mockResolvedValue(paired);
    const current = { id: "1", conversationId: null, inReplyToId: null, surface: "reply", author: "@ada", url: null, text: "Current post" };
    loadPanelData.mockResolvedValue({
      lock: current,
      lockSupported: true,
      deskState: { view: "scout", detected: false },
      replyAt: [],
      scout: null,
    });
    askDeskForNext.mockResolvedValue(true);
    waitForLockChange.mockResolvedValue(null);
    const { container, root } = await mountPanel();

    expect(buttonLabelled(container, "Next")?.className).toBe("primary");
    await press(container, "Next");

    expect(askDeskForNext).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No reply detected yet. Skip this card?");

    await press(container, "Skip card");

    expect(askDeskForNext).toHaveBeenCalledTimes(1);
    expect(askDeskForNext).toHaveBeenCalledWith(expect.anything(), { fromCardId: "1" });
    await act(async () => root.unmount());
  });

  it("does not offer Next on an undetected suggested reply card", async () => {
    readPairing.mockResolvedValue(paired);
    const current = { id: "1", conversationId: null, inReplyToId: null, surface: "reply", author: "@ada", url: null, text: "Current post" };
    loadPanelData.mockResolvedValue({
      lock: current,
      lockSupported: true,
      deskState: { view: "suggestion", detected: false },
      replyAt: [],
      scout: null,
    });
    const { container, root } = await mountPanel();

    expect(buttonLabelled(container, "Next")).toBeUndefined();
    await act(async () => root.unmount());
  });

  it("cancels the question with Escape", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, replyAt: [], repliesToday: null, scout: null });
    const { container, root } = await mountPanel();

    await press(container, "Next");
    await act(async () => {
      buttonLabelled(container, "Keep waiting")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(container.textContent).not.toContain("Skip this card?");
    expect(askDeskForNext).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("drops the question when the desk reports the post detected", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData
      .mockResolvedValueOnce({ lock: null, lockSupported: true, replyAt: [], repliesToday: null, scout: null })
      .mockResolvedValue({ lock: null, lockSupported: true, deskState: { view: "for_you", detected: true }, replyAt: [], repliesToday: null, scout: null });
    const { container, root } = await mountPanel();

    await press(container, "Next");
    expect(container.textContent).toContain("Skip this card?");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(container.textContent).not.toContain("Skip this card?");
    expect(buttonLabelled(container, "Next")?.className).toBe("primary");
    expect(buttonLabelled(container, "Open For You")).toBeUndefined();
    await act(async () => root.unmount());
  });

  it("advances a detected card with one click and shows only Next", async () => {
    readPairing.mockResolvedValue(paired);
    const current = { id: "1", conversationId: null, inReplyToId: null, surface: "reply", author: "@ada", url: null, text: "Current post" };
    loadPanelData.mockResolvedValue({
      lock: current,
      lockSupported: true,
      deskState: { view: "scout", detected: true },
      replyAt: [],
      scout: null,
    });
    askDeskForNext.mockResolvedValue(true);
    waitForLockChange.mockResolvedValue(null);
    const { container, root } = await mountPanel();

    expect(Array.from(container.querySelectorAll(".actions button")).map((button) => button.textContent)).toEqual(["Next"]);

    await press(container, "Next");

    expect(container.textContent).not.toContain("Skip this card?");
    expect(askDeskForNext).toHaveBeenCalledWith(expect.anything(), { fromCardId: "1" });
    await act(async () => root.unmount());
  });

  const scoutCard = { id: "1", conversationId: "c1", inReplyToId: "p1", surface: "reply", author: "@ada", url: "https://x.com/ada/status/1", text: "Current post" };
  const nextScoutCard = { ...scoutCard, id: "2", author: "@bo", url: "https://x.com/bo/status/2", text: "Next post" };

  function actionLabels(container: HTMLElement): (string | null)[] {
    return Array.from(container.querySelectorAll(".actions button")).map((button) => button.textContent);
  }

  it("offers Skip and Not interested as hollow buttons on an undetected Scout card, as the desk does", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: scoutCard, lockSupported: true, deskState: { view: "scout", detected: false }, replyAt: [], scout: null });
    const { container, root } = await mountPanel();

    expect(actionLabels(container)).toEqual(["Open post on X", "Next", "Skip", "Not interested"]);
    expect(buttonLabelled(container, "Skip")?.className).toBe("ghost");
    expect(buttonLabelled(container, "Not interested")?.className).toBe("ghost");
    await act(async () => root.unmount());
  });

  it.each([
    ["a detected Scout card", { lock: scoutCard, deskState: { view: "scout", detected: true } }],
    ["the For You card", { lock: null, deskState: { view: "for_you", detected: false } }],
    ["the Collecting card", { lock: null, deskState: { view: "collecting", detected: false } }],
    ["a card the desk is not on", { lock: scoutCard, deskState: { view: "other", detected: false } }],
    ["a suggested card whose suggestion is unknown", { lock: scoutCard, deskState: { view: "suggestion", detected: false } }],
    ["a detected suggested card", { lock: scoutCard, deskState: { view: "suggestion", detected: true }, suggestionId: "s1" }],
  ])("offers neither Skip nor Not interested on %s", async (_name, data) => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lockSupported: true, replyAt: [], scout: null, ...data });
    const { container, root } = await mountPanel();

    expect(buttonLabelled(container, "Skip")).toBeUndefined();
    expect(buttonLabelled(container, "Not interested")).toBeUndefined();
    await act(async () => root.unmount());
  });

  it("records the Skip, then moves to the next card by the same server-first path as Next", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: scoutCard, lockSupported: true, deskState: { view: "scout", detected: false }, replyAt: [], scout: null });
    const order: string[] = [];
    recordCardAction.mockImplementation(async () => { order.push("record"); });
    askDeskForNext.mockImplementation(async () => { order.push("advance"); return "server"; });
    waitForLockChange.mockResolvedValue({ card: nextScoutCard, next: null, state: { view: "scout", detected: false }, suggestionId: null, supported: true, valid: true });
    const { container, root } = await mountPanel();

    await press(container, "Skip");
    await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });

    expect(order).toEqual(["record", "advance"]);
    expect(recordCardAction).toHaveBeenCalledWith(paired, { kind: "scout", card: scoutCard }, "skip", "");
    expect(askDeskForNext).toHaveBeenCalledWith(paired, { fromCardId: "1", action: "skip", kind: "scout" });
    expect(waitForLockChange).toHaveBeenCalledWith(paired, { fromCardId: "1", action: "skip", kind: "scout" });
    expect(shownCard(container)?.textContent).toContain("@bo");
    expect(tabsCreate).toHaveBeenCalledWith({ url: "https://x.com/bo/status/2", active: true });
    await act(async () => root.unmount());
  });

  it("hides Skip and Not interested while the Skip is in flight", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: scoutCard, lockSupported: true, deskState: { view: "scout", detected: false }, replyAt: [], scout: null });
    let finish: () => void = () => undefined;
    recordCardAction.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    askDeskForNext.mockResolvedValue(null);
    const { container, root } = await mountPanel();

    await press(container, "Skip");

    expect(buttonLabelled(container, "Skip")).toBeUndefined();
    expect(buttonLabelled(container, "Not interested")).toBeUndefined();
    expect(buttonLabelled(container, "Next")?.disabled).toBe(true);
    await act(async () => {
      finish();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(buttonLabelled(container, "Skip")).toBeDefined();
    await act(async () => root.unmount());
  });

  it("stays on the card with the desk's notice when the Skip cannot be recorded", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: scoutCard, lockSupported: true, deskState: { view: "scout", detected: false }, replyAt: [], scout: null });
    recordCardAction.mockRejectedValue(new Error("/api/skipped failed (500)"));
    const { container, root } = await mountPanel();

    await press(container, "Skip");

    expect(askDeskForNext).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Could not skip. Try again.");
    expect(shownCard(container)?.textContent).toContain("@ada");
    expect(buttonLabelled(container, "Skip")).toBeDefined();
    await act(async () => root.unmount());
  });

  it("asks inline for an optional reason before Not interested, then records it and moves on", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: scoutCard, lockSupported: true, deskState: { view: "scout", detected: false }, replyAt: [], scout: null });
    recordCardAction.mockResolvedValue(undefined);
    askDeskForNext.mockResolvedValue("desk");
    waitForLockChange.mockResolvedValue({ card: nextScoutCard, next: null, state: { view: "scout", detected: false }, suggestionId: null, supported: true, valid: true });
    const { container, root } = await mountPanel();

    await press(container, "Not interested");

    expect(recordCardAction).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Dismiss @ada from Approach. Optional reason is saved to local knowledge memory.");
    const reason = container.querySelector<HTMLTextAreaElement>(".dismiss-confirm textarea");
    expect(reason).not.toBeNull();
    expect(document.activeElement).toBe(reason);
    expect(buttonLabelled(container, "Confirm")?.className).toBe("primary");
    expect(buttonLabelled(container, "Cancel")?.className).toBe("ghost");
    expect(buttonLabelled(container, "Skip")).toBeUndefined();

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setValue?.call(reason, "Off topic");
      reason?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press(container, "Confirm");
    await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });

    expect(recordCardAction).toHaveBeenCalledWith(paired, { kind: "scout", card: scoutCard }, "dismiss", "Off topic");
    expect(askDeskForNext).toHaveBeenCalledWith(paired, { fromCardId: "1", action: "dismiss", kind: "scout" });
    expect(shownCard(container)?.textContent).toContain("@bo");
    expect(shownCard(container)?.querySelector(".dismiss-confirm")).toBeNull();
    await act(async () => root.unmount());
  });

  it("cancels Not interested with Cancel or Escape and records nothing", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: scoutCard, lockSupported: true, deskState: { view: "scout", detected: false }, replyAt: [], scout: null });
    const { container, root } = await mountPanel();

    await press(container, "Not interested");
    await press(container, "Cancel");
    expect(container.querySelector(".dismiss-confirm")).toBeNull();
    expect(buttonLabelled(container, "Not interested")).toBeDefined();

    await press(container, "Not interested");
    await act(async () => {
      container.querySelector("textarea")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector(".dismiss-confirm")).toBeNull();
    expect(recordCardAction).not.toHaveBeenCalled();
    expect(askDeskForNext).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("keeps the reason open with the desk's notice when Not interested cannot be recorded", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: scoutCard, lockSupported: true, deskState: { view: "scout", detected: false }, replyAt: [], scout: null });
    recordCardAction.mockRejectedValue(new Error("/api/dismissed failed (500)"));
    const { container, root } = await mountPanel();

    await press(container, "Not interested");
    await press(container, "Confirm");

    expect(askDeskForNext).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Could not dismiss. Try again.");
    expect(container.querySelector(".dismiss-confirm")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("skips and dismisses a suggested reply card by its suggestion id, with no reason step, as the desk does", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: scoutCard, lockSupported: true, deskState: { view: "suggestion", detected: false }, suggestionId: "sugg-1", replyAt: [], scout: null });
    recordCardAction.mockResolvedValue(undefined);
    askDeskForNext.mockResolvedValue("server");
    waitForLockChange.mockResolvedValue({ card: scoutCard, next: null, state: { view: "suggestion", detected: false }, suggestionId: "sugg-1", supported: true, valid: true });
    const { container, root } = await mountPanel();

    expect(actionLabels(container)).toEqual(["Open post on X", "Skip", "Not interested"]);
    await press(container, "Skip");
    const target = { kind: "suggestion", card: scoutCard, suggestionId: "sugg-1" };
    expect(recordCardAction).toHaveBeenLastCalledWith(paired, target, "skip", "");
    expect(askDeskForNext).toHaveBeenLastCalledWith(paired, { fromCardId: "sugg-1", action: "skip", kind: "suggestion" });
    expect(waitForLockChange).toHaveBeenLastCalledWith(paired, { fromCardId: "sugg-1", action: "skip", kind: "suggestion" });

    await press(container, "Not interested");
    expect(container.querySelector(".dismiss-confirm")).toBeNull();
    expect(recordCardAction).toHaveBeenLastCalledWith(paired, target, "dismiss", "");
    expect(askDeskForNext).toHaveBeenLastCalledWith(paired, { fromCardId: "sugg-1", action: "dismiss", kind: "suggestion" });
    expect(waitForLockChange).toHaveBeenLastCalledWith(paired, { fromCardId: "sugg-1", action: "dismiss", kind: "suggestion" });
    await act(async () => root.unmount());
  });

  it("names For You in the notice when a suggested card cannot be skipped", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: scoutCard, lockSupported: true, deskState: { view: "suggestion", detected: false }, suggestionId: "sugg-1", replyAt: [], scout: null });
    recordCardAction.mockRejectedValue(new Error("/api/for-you/skip failed (404)"));
    const { container, root } = await mountPanel();

    await press(container, "Skip");

    expect(askDeskForNext).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Could not update For You. Try again.");
    await act(async () => root.unmount());
  });

  const ogSuggestion = {
    id: "sug-og",
    kind: "post",
    why: "Take a side on whether AI wealth gains actually reach displaced workers, invite replies",
    targetId: null,
    targetUrl: null,
    targetAuthor: null,
    openUrl: "https://x.com/intent/tweet",
  };
  const ogState = { view: "suggestion", detected: false, suggestion: ogSuggestion };
  const replySuggestion = {
    id: "sug-re",
    kind: "reply",
    why: "Join this thread",
    targetId: "1",
    targetUrl: "https://x.com/ada/status/1",
    targetAuthor: "@ada",
    openUrl: "https://x.com/ada/status/1",
  };

  it("shows the desk's original post card waiting for the post, with no I posted on X, and never uses its own For You detection", async () => {
    readPairing.mockResolvedValue(paired);
    const now = Date.now();
    storageData.lastReplySeenAt = now - 1_000;
    storageData.panelCardSince = { key: "for_you", sinceMs: now - 5_000 };
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, deskState: ogState, suggestionId: "sug-og", replyAt: [], scout: null });
    const { container, root } = await mountPanel();

    const card = shownCard(container);
    expect(card?.querySelector(".card-lead")?.textContent).toBe("OG");
    expect(card?.querySelector("h2")?.textContent).toBe(ogSuggestion.why);
    expect(card?.querySelector(".detect-tag")?.textContent).toBe("Waiting for your post");
    expect(card?.textContent).not.toContain("For You");
    expect(card?.textContent).not.toContain("Post detected");
    expect(actionLabels(container)).toEqual(["Open on X", "Next", "Skip", "Not interested"]);
    expect(buttonLabelled(container, "I posted on X")).toBeUndefined();
    expect(buttonLabelled(container, "Open on X")?.className).toBe("ghost");
    expect(buttonLabelled(container, "Next")?.className).toBe("primary");
    expect(buttonLabelled(container, "Next")?.disabled).toBe(false);
    expect(buttonLabelled(container, "Skip")?.className).toBe("ghost");

    await press(container, "Open on X");
    expect(tabsCreate).toHaveBeenCalledWith({ url: "https://x.com/home", active: true });
    await act(async () => root.unmount());
  });

  it("asks before moving off an original post card with no post detected, then moves on without recording it", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, deskState: ogState, suggestionId: "sug-og", replyAt: [], scout: null });
    askDeskForNext.mockResolvedValue("server");
    waitForLockChange.mockResolvedValue({ card: nextScoutCard, next: null, state: { view: "scout", detected: false }, suggestionId: null, supported: true, valid: true });
    const { container, root } = await mountPanel();

    await press(container, "Next");
    expect(askDeskForNext).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No post detected yet. Skip this card?");

    await press(container, "Skip card");
    await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });

    expect(recordCardAction).not.toHaveBeenCalled();
    expect(askDeskForNext).toHaveBeenCalledWith(paired, { fromCardId: "sug-og" });
    expect(waitForLockChange).toHaveBeenCalledWith(paired, { fromCardId: "sug-og" });
    expect(shownCard(container)?.textContent).toContain("@bo");
    await act(async () => root.unmount());
  });

  it("shows only Next once the desk detects the original post, then records it done with the post id and moves on", async () => {
    readPairing.mockResolvedValue(paired);
    const detectedState = { ...ogState, detected: true, post: { id: "1900000001", url: "https://x.com/me/status/1900000001" } };
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, deskState: detectedState, suggestionId: "sug-og", replyAt: [], scout: null });
    const order: string[] = [];
    recordCardAction.mockImplementation(async () => { order.push("record"); });
    askDeskForNext.mockImplementation(async () => { order.push("advance"); return "server"; });
    waitForLockChange.mockResolvedValue({ card: nextScoutCard, next: null, state: { view: "scout", detected: false }, suggestionId: null, supported: true, valid: true });
    const { container, root } = await mountPanel();

    expect(shownCard(container)?.querySelector(".detect-tag")?.textContent).toBe("Post detected");
    const detectedPostLink = shownCard(container)?.querySelector<HTMLAnchorElement>(".detail a");
    expect(detectedPostLink?.getAttribute("href")).toBe("https://x.com/me/status/1900000001");
    expect(detectedPostLink?.textContent).toBe("View post 1900000001");
    expect(actionLabels(container)).toEqual(["Next"]);

    await press(container, "Next");
    await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });

    const target = { kind: "suggestion", card: null, suggestionId: "sug-og" };
    expect(container.textContent).not.toContain("Skip this card?");
    expect(order).toEqual(["record", "advance"]);
    expect(recordCardAction).toHaveBeenCalledWith(paired, target, "posted", "", "1900000001");
    expect(askDeskForNext).toHaveBeenCalledWith(paired, { fromCardId: "sug-og", action: "posted", kind: "suggestion" });
    expect(waitForLockChange).toHaveBeenCalledWith(paired, { fromCardId: "sug-og", action: "posted", kind: "suggestion" });
    expect(shownCard(container)?.textContent).toContain("@bo");
    await act(async () => root.unmount());
  });

  it("skips an original post card by its suggestion id", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, deskState: ogState, suggestionId: "sug-og", replyAt: [], scout: null });
    recordCardAction.mockResolvedValue(undefined);
    askDeskForNext.mockResolvedValue("server");
    waitForLockChange.mockResolvedValue(null);
    const { container, root } = await mountPanel();

    await press(container, "Not interested");
    expect(container.querySelector(".dismiss-confirm")).toBeNull();
    expect(recordCardAction).toHaveBeenLastCalledWith(paired, { kind: "suggestion", card: null, suggestionId: "sug-og" }, "dismiss", "");
    expect(askDeskForNext).toHaveBeenLastCalledWith(paired, { fromCardId: "sug-og", action: "dismiss", kind: "suggestion" });
    expect(container.textContent).toContain("Your desk is open on another page.");
    expect(shownCard(container)?.querySelector("h2")?.textContent).toBe(ogSuggestion.why);
    await act(async () => root.unmount());
  });

  it("shows a suggested reply card like the desk: Next waits for detection, then is the only button and moves on", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData
      .mockResolvedValueOnce({ lock: scoutCard, lockSupported: true, deskState: { view: "suggestion", detected: false, suggestion: replySuggestion }, suggestionId: "sug-re", replyAt: [], scout: null })
      .mockResolvedValue({ lock: scoutCard, lockSupported: true, deskState: { view: "suggestion", detected: true, suggestion: replySuggestion }, suggestionId: "sug-re", replyAt: [], scout: null });
    recordCardAction.mockResolvedValue(undefined);
    askDeskForNext.mockResolvedValue("server");
    waitForLockChange.mockResolvedValue({ card: nextScoutCard, next: null, state: { view: "scout", detected: false }, suggestionId: null, supported: true, valid: true });
    const { container, root } = await mountPanel();

    expect(shownCard(container)?.querySelector(".card-lead")?.textContent).toBe("RE");
    expect(shownCard(container)?.querySelector("h2")?.textContent).toBe("Join this thread");
    expect(actionLabels(container)).toEqual(["Open on X", "Next", "Skip", "Not interested"]);
    expect(buttonLabelled(container, "Next")?.disabled).toBe(true);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(actionLabels(container)).toEqual(["Next"]);
    expect(buttonLabelled(container, "Next")?.disabled).toBe(false);

    await press(container, "Next");
    await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
    expect(container.textContent).not.toContain("Skip this card?");
    expect(recordCardAction).toHaveBeenCalledWith(paired, { kind: "suggestion", card: scoutCard, suggestionId: "sug-re" }, "posted", "");
    expect(askDeskForNext).toHaveBeenCalledWith(paired, { fromCardId: "sug-re", action: "posted", kind: "suggestion" });
    expect(shownCard(container)?.textContent).toContain("@bo");
    await act(async () => root.unmount());
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
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: false, replyAt: [], repliesToday: null, scout: null });
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
      .mockResolvedValueOnce({ lock: null, lockSupported: true, replyAt: [], repliesToday: null, scout: null })
      .mockResolvedValueOnce({ lock: null, lockSupported: true, replyAt: [], repliesToday: null, scout: null });
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
    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");
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
      .mockResolvedValueOnce({ lock: first, lockSupported: true, replyAt: [], repliesToday: null, scout: null })
      .mockResolvedValue({ lock: second, lockSupported: true, replyAt: [], repliesToday: null, scout: null });
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
      .mockResolvedValueOnce({ lock: first, lockSupported: true, replyAt: [], repliesToday: null, scout: null })
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

    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");
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
    expect(Array.from(shownCard(container)?.querySelectorAll("button") ?? []).some((button) => button.textContent === "Next")).toBe(false);

    await act(async () => root.unmount());
  });

  it("keeps the reading timer toggle behind the settings gear", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, replyAt: [], repliesToday: null, scout: null });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(container.querySelector("input[type=checkbox]")).toBeNull();
    expect(container.textContent).not.toContain("Reading timer");
    expect(buttonLabelled(container, "Account")).toBeUndefined();
    expect(buttonLabelled(container, "Open desk")).toBeUndefined();
    expect(container.querySelector("button[aria-label=Back]")).toBeNull();
    const gear = container.querySelector<HTMLButtonElement>("button[aria-label=Settings]");
    expect(gear?.querySelector("svg")).not.toBeNull();

    await act(async () => gear?.click());
    const toggle = container.querySelector<HTMLInputElement>("input[type=checkbox]");
    expect(container.textContent).toContain("Reading timer on posts");
    expect(container.textContent).toContain("Sign out");
    expect(toggle?.checked).toBe(true);

    await act(async () => toggle?.click());
    expect(storageData.attentionGate).toBe(false);

    expect(container.querySelector("button[aria-label=Settings]")).toBeNull();
    await act(async () => {
      buttonLabelled(container, "Account")?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(tabsCreate).toHaveBeenCalledWith({ url: "https://xcopilot.dev/account" });

    const back = container.querySelector<HTMLButtonElement>("button[aria-label=Back]");
    expect(back?.querySelector("svg")).not.toBeNull();
    await act(async () => back?.click());
    expect(container.querySelector("input[type=checkbox]")).toBeNull();
    expect(container.querySelector("button[aria-label=Back]")).toBeNull();
    expect(container.querySelector("button[aria-label=Settings]")).not.toBeNull();
    expect(container.textContent).toContain("Open For You");

    await act(async () => root.unmount());
  });

  it("opens the desk from an icon button in the header", async () => {
    readPairing.mockResolvedValue(paired);
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, replyAt: [], repliesToday: null, scout: null });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    const desk = container.querySelector<HTMLButtonElement>(".panel-head button[aria-label='Open desk']");
    expect(desk?.querySelector("svg")).not.toBeNull();
    expect(container.querySelector(".panel-links")).toBeNull();
    await act(async () => {
      desk?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(tabsCreate).toHaveBeenCalledWith({ url: "https://xcopilot.dev/dashboard" });

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
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, nextUp: { card: upNext }, replyAt: [], repliesToday: null, scout: null });
    askDeskForNext.mockResolvedValue(true);
    waitForLockChange.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");
    await act(async () => {
      next?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      buttonLabelled(container, "Skip card")?.click();
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
    loadPanelData.mockResolvedValue({ lock: current, lockSupported: true, nextUp: { card: preloaded }, replyAt: [], repliesToday: null, scout: null });
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
    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");
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

    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");
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
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, nextUp: { card: preloaded }, replyAt: [], repliesToday: null, scout: null });
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
    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");
    await act(async () => {
      next?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      buttonLabelled(container, "Skip card")?.click();
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
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, nextUp: { card: upNext }, replyAt: [], repliesToday: null, scout: null });
    askDeskForNext.mockResolvedValue(false);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");
    await act(async () => {
      next?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      buttonLabelled(container, "Skip card")?.click();
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
      .mockResolvedValueOnce({ lock: null, lockSupported: true, deskState: { view: "for_you", detected: false }, replyAt: [], repliesToday: null, scout: null })
      .mockResolvedValueOnce({ lock: null, lockSupported: true, deskState: collecting, replyAt: [], repliesToday: null, scout: null })
      .mockResolvedValue({ lock: found, lockSupported: true, deskState: { view: "scout", detected: false }, replyAt: [], repliesToday: null, scout: null });
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

    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");
    await act(async () => {
      next?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      buttonLabelled(container, "Skip card")?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(shownCard(container)?.textContent).toContain("Scout is collecting posts");
    expect(shownCard(container)?.textContent).toContain("Waiting for Scout");
    expect(shownCard(container)?.textContent).not.toContain("Next");
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

  it("shows the card the server picked when no desk is open, without flashing the stale preloaded one", async () => {
    readPairing.mockResolvedValue(paired);
    const now = Date.now();
    storageData.lastReplySeenAt = now - 1_000;
    storageData.panelCardSince = { key: "for_you", sinceMs: now - 5_000 };
    const stale = { id: "42", conversationId: null, inReplyToId: null, surface: "reply", author: "@dana", url: null, text: "Stale preloaded post" };
    const picked = { ...stale, id: "77", author: "@eve", text: "Picked by the server" };
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, nextUp: { card: stale }, replyAt: [], repliesToday: null, scout: null });
    askDeskForNext.mockResolvedValue("server");
    let confirm!: (value: unknown) => void;
    waitForLockChange.mockReturnValue(new Promise((resolve) => { confirm = resolve; }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");
    await act(async () => {
      expect(next).toBeDefined();
      next?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(container.textContent).not.toContain("Stale preloaded post");
    expect(container.textContent).not.toContain("Open your desk dashboard");

    await act(async () => {
      confirm({ card: picked, next: null, state: { view: "scout", detected: false }, supported: true, valid: true });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(shownCard(container)?.textContent).toContain("Picked by the server");

    await act(async () => root.unmount());
  });

  it("shows the reply timer only after Next, like the desk, and hides it when the minute ends", async () => {
    vi.useFakeTimers();
    readPairing.mockResolvedValue(paired);
    const now = Date.now();
    storageData.lastReplySeenAt = now - 1_000;
    storageData.panelCardSince = { key: "for_you", sinceMs: now - 5_000 };
    const justReplied = new Date(now - 5_000).toISOString();
    const nextCard = { id: "77", conversationId: null, inReplyToId: null, surface: "reply", author: "@eve", url: null, text: "Next post" };
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, replyAt: [justReplied], repliesToday: 1, scout: null });
    askDeskForNext.mockResolvedValue("server");
    waitForLockChange.mockResolvedValue({ card: nextCard, next: null, state: { view: "scout", detected: false }, supported: true, valid: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.textContent).toContain("Post detected");
    expect(container.querySelector("[role=timer]")).toBeNull();

    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");
    await act(async () => {
      next?.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(shownCard(container)?.textContent).toContain("Next post");
    expect(shownCard(container)?.querySelector("[role=timer]")?.textContent).toContain("Next reply in");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(55_000);
    });
    expect(shownCard(container)?.querySelector("[role=timer]")).toBeNull();

    loadPanelData.mockResolvedValueOnce({
      lock: null,
      lockSupported: true,
      replyAt: [new Date(Date.now() - 1_000).toISOString()],
      repliesToday: 2,
      scout: null,
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(shownCard(container)?.querySelector("[role=timer]")).toBeNull();

    await act(async () => root.unmount());
  });

  it("does not arm the reply timer when Next completes after the reply minute ends", async () => {
    vi.useFakeTimers();
    readPairing.mockResolvedValue(paired);
    const now = Date.now();
    storageData.lastReplySeenAt = now - 1_000;
    storageData.panelCardSince = { key: "for_you", sinceMs: now - 5_000 };
    const nextCard = { id: "77", conversationId: null, inReplyToId: null, surface: "reply", author: "@eve", url: null, text: "Next post" };
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, replyAt: [new Date(now - 55_000).toISOString()], repliesToday: 1, scout: null });
    askDeskForNext.mockResolvedValue("server");
    let confirm!: (value: unknown) => void;
    waitForLockChange.mockReturnValue(new Promise((resolve) => { confirm = resolve; }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await vi.advanceTimersByTimeAsync(0);
    });
    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");
    await act(async () => {
      next?.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    await act(async () => {
      confirm({ card: nextCard, next: null, state: { view: "scout", detected: false }, supported: true, valid: true });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(shownCard(container)?.textContent).toContain("Next post");
    expect(shownCard(container)?.querySelector("[role=timer]")).toBeNull();

    loadPanelData.mockResolvedValueOnce({
      lock: null,
      lockSupported: true,
      replyAt: [new Date(Date.now() - 1_000).toISOString()],
      repliesToday: 2,
      scout: null,
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(shownCard(container)?.querySelector("[role=timer]")).toBeNull();

    await act(async () => root.unmount());
  });

  it("does not show the reply timer when Next could not move the card", async () => {
    readPairing.mockResolvedValue(paired);
    const now = Date.now();
    storageData.lastReplySeenAt = now - 1_000;
    storageData.panelCardSince = { key: "for_you", sinceMs: now - 5_000 };
    loadPanelData.mockResolvedValue({ lock: null, lockSupported: true, replyAt: [new Date(now - 5_000).toISOString()], repliesToday: 1, scout: null });
    askDeskForNext.mockResolvedValue(null);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");
    await act(async () => {
      next?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("No next card could be picked yet");
    expect(container.querySelector("[role=timer]")).toBeNull();

    await act(async () => root.unmount());
  });
});
