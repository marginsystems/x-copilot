import { beforeEach, describe, expect, it, vi } from "vitest";
import contentScript from "../entrypoints/x.content";
import { ATTENTION_GATE_KEY } from "../lib/settings";

const state = vi.hoisted(() => ({
  intervalCallback: undefined as (() => void) | undefined,
  changeListener: undefined as ((changes: Record<string, { newValue?: unknown }>, area: string) => void) | undefined,
  sendMessage: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      sendMessage: state.sendMessage,
    },
    storage: {
      onChanged: {
        addListener: (listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => {
          state.changeListener = listener;
        },
      },
    },
  },
}));

vi.mock("wxt/utils/define-content-script", () => ({
  defineContentScript: (definition: unknown) => definition,
}));

vi.mock("../lib/settingsStore", () => ({
  readAttentionGate: () => new Promise<boolean>(() => undefined),
}));

describe("x content attention polling", () => {
  beforeEach(() => {
    state.intervalCallback = undefined;
    state.changeListener = undefined;
    vi.restoreAllMocks();
    state.sendMessage.mockReset();
    state.sendMessage.mockResolvedValue({ ok: true });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    document.documentElement.innerHTML = "<head></head><body></body>";
    window.history.replaceState(null, "", "/home");
    window.sessionStorage.clear();
  });

  it("skips post scans off post pages and while the gate is disabled", () => {
    const querySelectorAll = vi.spyOn(document, "querySelectorAll");
    const context = {
      setInterval: (callback: () => void) => {
        state.intervalCallback = callback;
      },
      onInvalidated: () => undefined,
    } as unknown as NonNullable<Parameters<typeof contentScript.main>[0]>;

    contentScript.main(context);
    state.intervalCallback?.();
    expect(querySelectorAll).not.toHaveBeenCalled();

    window.history.replaceState(null, "", "/user/status/123");
    state.intervalCallback?.();
    expect(querySelectorAll).not.toHaveBeenCalled();

    state.intervalCallback?.();
    expect(querySelectorAll).toHaveBeenCalledTimes(1);

    state.changeListener?.({ [ATTENTION_GATE_KEY]: { newValue: false } }, "local");
    state.intervalCallback?.();
    expect(querySelectorAll).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh ready linger after navigating while the composer is missing", () => {
    let nowMs = 0;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");

    const post = document.createElement("article");
    post.setAttribute("data-testid", "tweet");
    vi.spyOn(post, "getBoundingClientRect").mockReturnValue({
      top: 10,
      bottom: 100,
      left: 10,
      right: 300,
      width: 290,
      height: 90,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    });
    document.body.append(post);

    const composer = document.createElement("div");
    composer.setAttribute("data-testid", "tweetTextarea_0");
    vi.spyOn(composer, "getBoundingClientRect").mockReturnValue({
      top: 200,
      bottom: 240,
      left: 10,
      right: 300,
      width: 290,
      height: 40,
      x: 10,
      y: 200,
      toJSON: () => ({}),
    });
    document.body.append(composer);

    const context = {
      setInterval: (callback: () => void) => {
        state.intervalCallback = callback;
      },
      onInvalidated: () => undefined,
    } as unknown as NonNullable<Parameters<typeof contentScript.main>[0]>;
    const attachShadow = vi.spyOn(Element.prototype, "attachShadow");

    window.history.replaceState(null, "", "/user/status/123");
    contentScript.main(context);
    state.intervalCallback?.();
    for (let second = 1; second <= 12; second += 1) {
      nowMs = second * 1_000;
      state.intervalCallback?.();
    }

    const chip = attachShadow.mock.results[0]?.value.querySelector(".chip");
    expect(chip?.classList.contains("gone")).toBe(true);

    composer.remove();
    window.history.replaceState(null, "", "/user/status/456");
    for (let second = 13; second <= 23; second += 1) {
      nowMs = second * 1_000;
      state.intervalCallback?.();
    }

    document.body.append(composer);
    state.intervalCallback?.();
    expect(chip?.textContent).toBe("Ready");
    expect(chip?.classList.contains("gone")).toBe(false);

    vi.restoreAllMocks();
  });

  it("keeps a post's reading time across a detour and a fresh script on the same tab", () => {
    let nowMs = 0;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");

    const box = (top: number, height: number) => ({
      top,
      bottom: top + height,
      left: 10,
      right: 300,
      width: 290,
      height,
      x: 10,
      y: top,
      toJSON: () => ({}),
    });
    const post = document.createElement("article");
    post.setAttribute("data-testid", "tweet");
    vi.spyOn(post, "getBoundingClientRect").mockReturnValue(box(10, 90));
    const composer = document.createElement("div");
    composer.setAttribute("data-testid", "tweetTextarea_0");
    vi.spyOn(composer, "getBoundingClientRect").mockReturnValue(box(200, 40));
    document.body.append(post, composer);

    const invalidations: Array<() => void> = [];
    const context = {
      setInterval: (callback: () => void) => {
        state.intervalCallback = callback;
      },
      onInvalidated: (callback: () => void) => {
        invalidations.push(callback);
      },
    } as unknown as NonNullable<Parameters<typeof contentScript.main>[0]>;
    const attachShadow = vi.spyOn(Element.prototype, "attachShadow");
    const chipText = (index: number) => attachShadow.mock.results[index]?.value.querySelector(".chip")?.textContent;

    window.history.replaceState(null, "", "/user/status/789");
    contentScript.main(context);
    state.intervalCallback?.();
    for (let second = 1; second <= 4; second += 1) {
      nowMs = second * 1_000;
      state.intervalCallback?.();
    }
    expect(chipText(0)).toBe("Reading6s");

    window.history.replaceState(null, "", "/compose/post");
    nowMs = 4_250;
    state.intervalCallback?.();
    window.history.replaceState(null, "", "/user/status/789");
    nowMs = 4_500;
    state.intervalCallback?.();
    expect(chipText(0)).toBe("Reading6s");

    for (const invalidate of invalidations) invalidate();
    expect(document.querySelectorAll('[data-x-copilot="attention"]')).toHaveLength(0);

    contentScript.main(context);
    nowMs = 5_000;
    state.intervalCallback?.();
    expect(chipText(1)).toBe("Reading6s");
    expect(document.querySelectorAll('[data-x-copilot="attention"]')).toHaveLength(1);

    vi.restoreAllMocks();
  });

  it("counts reading time while the page lacks focus but its browser window is focused", async () => {
    let nowMs = 0;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    state.sendMessage.mockResolvedValue({ focused: true });

    const box = (top: number, height: number) => ({
      top,
      bottom: top + height,
      left: 10,
      right: 300,
      width: 290,
      height,
      x: 10,
      y: top,
      toJSON: () => ({}),
    });
    const post = document.createElement("article");
    post.setAttribute("data-testid", "tweet");
    vi.spyOn(post, "getBoundingClientRect").mockReturnValue(box(10, 90));
    const composer = document.createElement("div");
    composer.setAttribute("data-testid", "tweetTextarea_0");
    vi.spyOn(composer, "getBoundingClientRect").mockReturnValue(box(200, 40));
    document.body.append(post, composer);

    const context = {
      setInterval: (callback: () => void) => {
        state.intervalCallback = callback;
      },
      onInvalidated: () => undefined,
    } as unknown as NonNullable<Parameters<typeof contentScript.main>[0]>;
    const attachShadow = vi.spyOn(Element.prototype, "attachShadow");
    const chipText = () => attachShadow.mock.results[0]?.value.querySelector(".chip")?.textContent;
    const tick = async (atMs: number) => {
      nowMs = atMs;
      state.intervalCallback?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    window.history.replaceState(null, "", "/user/status/321");
    contentScript.main(context);
    await tick(0);
    expect(state.sendMessage).toHaveBeenCalledWith({ type: "x-copilot:window-focused" });
    for (let second = 1; second <= 3; second += 1) await tick(second * 1_000);
    expect(chipText()).toBe("Reading7s");

    state.sendMessage.mockResolvedValue({ focused: false });
    await tick(3_250);
    await tick(4_000);
    const afterLosingFocus = chipText();
    expect(["Reading7s", "Reading6s"]).toContain(afterLosingFocus);
    for (let second = 5; second <= 8; second += 1) await tick(second * 1_000);
    expect(chipText()).toBe(afterLosingFocus);
  });

  it("asks the browser for window focus at most once a second", async () => {
    let nowMs = 0;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    state.sendMessage.mockResolvedValue({ focused: false });
    const post = document.createElement("article");
    post.setAttribute("data-testid", "tweet");
    vi.spyOn(post, "getBoundingClientRect").mockReturnValue({
      top: 10, bottom: 100, left: 10, right: 300, width: 290, height: 90, x: 10, y: 10, toJSON: () => ({}),
    });
    document.body.append(post);
    const context = {
      setInterval: (callback: () => void) => {
        state.intervalCallback = callback;
      },
      onInvalidated: () => undefined,
    } as unknown as NonNullable<Parameters<typeof contentScript.main>[0]>;

    window.history.replaceState(null, "", "/user/status/654");
    contentScript.main(context);
    for (let quarter = 0; quarter <= 12; quarter += 1) {
      nowMs = quarter * 250;
      state.intervalCallback?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const asks = state.sendMessage.mock.calls.filter(([message]) => message?.type === "x-copilot:window-focused");
    expect(asks).toHaveLength(4);
  });

  it("stops reading the page layout once the post is read and its chip has gone", () => {
    let nowMs = 0;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const box = { top: 10, bottom: 100, left: 10, right: 300, width: 290, height: 90, x: 10, y: 10, toJSON: () => ({}) };
    const post = document.createElement("article");
    post.setAttribute("data-testid", "tweet");
    const postRect = vi.spyOn(post, "getBoundingClientRect").mockReturnValue(box);
    const composer = document.createElement("div");
    composer.setAttribute("data-testid", "tweetTextarea_0");
    const composerRect = vi.spyOn(composer, "getBoundingClientRect").mockReturnValue({ ...box, top: 200, bottom: 240, y: 200 });
    document.body.append(post, composer);
    const context = {
      setInterval: (callback: () => void) => {
        state.intervalCallback = callback;
      },
      onInvalidated: () => undefined,
    } as unknown as NonNullable<Parameters<typeof contentScript.main>[0]>;

    window.history.replaceState(null, "", "/user/status/777");
    contentScript.main(context);
    for (let second = 0; second <= 14; second += 1) {
      nowMs = second * 1_000;
      state.intervalCallback?.();
    }
    postRect.mockClear();
    composerRect.mockClear();
    for (let second = 15; second <= 20; second += 1) {
      nowMs = second * 1_000;
      state.intervalCallback?.();
    }
    expect(postRect).not.toHaveBeenCalled();
    expect(composerRect).not.toHaveBeenCalled();
  });

  it("does not request window focus while hidden or while the post is off screen", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    let postTop = 2_000;
    const post = document.createElement("article");
    post.setAttribute("data-testid", "tweet");
    vi.spyOn(post, "getBoundingClientRect").mockImplementation(() => ({
      top: postTop,
      bottom: postTop + 90,
      left: 10,
      right: 300,
      width: 290,
      height: 90,
      x: 10,
      y: postTop,
      toJSON: () => ({}),
    }));
    document.body.append(post);

    const context = {
      setInterval: (callback: () => void) => {
        state.intervalCallback = callback;
      },
      onInvalidated: () => undefined,
    } as unknown as NonNullable<Parameters<typeof contentScript.main>[0]>;

    window.history.replaceState(null, "", "/user/status/654");
    contentScript.main(context);
    state.intervalCallback?.();
    state.intervalCallback?.();
    expect(state.sendMessage).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    state.intervalCallback?.();
    expect(state.sendMessage).not.toHaveBeenCalled();

    postTop = 10;
    state.intervalCallback?.();
    expect(state.sendMessage).toHaveBeenCalledWith({ type: "x-copilot:window-focused" });
  });

  it("reports a sent-post toast on the next tick without watching page mutations, once per post", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const context = {
      setInterval: (callback: () => void) => {
        state.intervalCallback = callback;
      },
      onInvalidated: () => undefined,
    } as unknown as NonNullable<Parameters<typeof contentScript.main>[0]>;

    window.history.replaceState(null, "", "/user/status/123");
    contentScript.main(context);
    state.intervalCallback?.();
    expect(observe).not.toHaveBeenCalled();

    const layers = document.createElement("div");
    layers.id = "layers";
    const toast = document.createElement("div");
    toast.setAttribute("data-testid", "toast");
    const link = document.createElement("a");
    link.setAttribute("href", "/me/status/555");
    toast.append(link);
    layers.append(toast);
    document.body.append(layers);
    expect(state.sendMessage).not.toHaveBeenCalled();

    state.intervalCallback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    expect(state.sendMessage).toHaveBeenCalledWith({
      type: "x-copilot:reply-seen",
      replyUrl: "https://x.com/me/status/555",
      pageStatusId: "123",
    });

    state.intervalCallback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("retries a failed toast report once on a later tick, then stops", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    state.sendMessage.mockResolvedValue({ ok: false });
    const context = {
      setInterval: (callback: () => void) => {
        state.intervalCallback = callback;
      },
      onInvalidated: () => undefined,
    } as unknown as NonNullable<Parameters<typeof contentScript.main>[0]>;

    window.history.replaceState(null, "", "/home");
    contentScript.main(context);

    const toast = document.createElement("div");
    toast.setAttribute("data-testid", "toast");
    const link = document.createElement("a");
    link.setAttribute("href", "/me/status/555");
    toast.append(link);
    document.body.append(toast);

    for (let tick = 0; tick < 4; tick += 1) {
      state.intervalCallback?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(state.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("does not look for toasts while the tab is hidden", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const context = {
      setInterval: (callback: () => void) => {
        state.intervalCallback = callback;
      },
      onInvalidated: () => undefined,
    } as unknown as NonNullable<Parameters<typeof contentScript.main>[0]>;
    window.history.replaceState(null, "", "/home");
    contentScript.main(context);
    const toast = document.createElement("div");
    toast.setAttribute("data-testid", "toast");
    const link = document.createElement("a");
    link.setAttribute("href", "/me/status/555");
    toast.append(link);
    document.body.append(toast);
    state.intervalCallback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.sendMessage).not.toHaveBeenCalled();
  });
});
