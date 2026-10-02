import { beforeEach, describe, expect, it, vi } from "vitest";
import contentScript from "../entrypoints/x.content";
import { ATTENTION_GATE_KEY } from "../lib/settings";

const state = vi.hoisted(() => ({
  intervalCallback: undefined as (() => void) | undefined,
  changeListener: undefined as ((changes: Record<string, { newValue?: unknown }>, area: string) => void) | undefined,
}));

vi.mock("wxt/browser", () => ({
  browser: {
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
    document.documentElement.innerHTML = "";
    window.history.replaceState(null, "", "/home");
  });

  it("skips post scans off post pages and while the gate is disabled", () => {
    const querySelectorAll = vi.spyOn(document, "querySelectorAll");
    const context = {
      setInterval: (callback: () => void) => {
        state.intervalCallback = callback;
      },
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
});
