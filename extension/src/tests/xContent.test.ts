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
    state.sendMessage.mockReset();
    state.sendMessage.mockResolvedValue({ ok: true });
    document.documentElement.innerHTML = "<head></head><body></body>";
    window.history.replaceState(null, "", "/home");
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

  it("reports added toast links without rescanning the document and dedupes sent links", async () => {
    const querySelectorAll = vi.spyOn(document, "querySelectorAll");
    const context = {
      setInterval: (callback: () => void) => {
        state.intervalCallback = callback;
      },
      onInvalidated: () => undefined,
    } as unknown as NonNullable<Parameters<typeof contentScript.main>[0]>;

    window.history.replaceState(null, "", "/user/status/123");
    contentScript.main(context);
    state.intervalCallback?.();

    const toast = document.createElement("div");
    toast.setAttribute("data-testid", "toast");
    const link = document.createElement("a");
    link.setAttribute("href", "/me/status/555");
    toast.append(link);
    document.body.append(toast);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    expect(state.sendMessage).toHaveBeenCalledWith({
      type: "x-copilot:reply-seen",
      replyUrl: "https://x.com/me/status/555",
      pageStatusId: "123",
    });
    expect(querySelectorAll).not.toHaveBeenCalledWith('[data-testid="toast"] a[href*="/status/"]');

    link.remove();
    toast.append(link);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("retries a failed toast report only once across later page mutations", async () => {
    state.sendMessage.mockResolvedValue({ ok: false });
    const context = {
      setInterval: (callback: () => void) => {
        state.intervalCallback = callback;
      },
      onInvalidated: () => undefined,
    } as unknown as NonNullable<Parameters<typeof contentScript.main>[0]>;

    window.history.replaceState(null, "", "/user/status/123");
    contentScript.main(context);
    state.intervalCallback?.();

    const toast = document.createElement("div");
    toast.setAttribute("data-testid", "toast");
    const link = document.createElement("a");
    link.setAttribute("href", "/me/status/555");
    toast.append(link);
    document.body.append(toast);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.sendMessage).toHaveBeenCalledTimes(1);

    document.body.append(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.sendMessage).toHaveBeenCalledTimes(2);

    const replacementToast = document.createElement("div");
    replacementToast.setAttribute("data-testid", "toast");
    const replacementLink = document.createElement("a");
    replacementLink.setAttribute("href", "/me/status/555");
    replacementToast.append(replacementLink);
    document.body.append(replacementToast);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.sendMessage).toHaveBeenCalledTimes(2);
  });
});
