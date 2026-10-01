import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  armReplyPace,
  seedReplyPaceFromReplyAt,
  armReplyPaceOverlay,
  clearReplyPaceOverlay,
  clearReplyPace,
  readReplyPaceOverlay,
} from "./replyPaceStore.ts";

await describe("reply pace overlay storage", () => {
  it("persists until expiry or Bypass clears it", (t) => {
    const stored = new Map<string, string>();
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
    t.after(() => {
      if (storageDescriptor) Object.defineProperty(globalThis, "sessionStorage", storageDescriptor);
      else Reflect.deleteProperty(globalThis, "sessionStorage");
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      else Reflect.deleteProperty(globalThis, "window");
    });
    assert.equal(readReplyPaceOverlay(), false);
    const now = Date.parse("2026-09-15T12:00:20.000Z");
    assert.equal(seedReplyPaceFromReplyAt("2026-09-15T12:00:00.000Z", now),
      Date.parse("2026-09-15T12:01:00.000Z"));
    assert.equal(readReplyPaceOverlay(), false, "Detect seeds data without an overlay");
    armReplyPace(now);
    assert.equal(readReplyPaceOverlay(), false, "A running clock does not arm the overlay");
    for (const markCleared of [false, true]) {
      armReplyPaceOverlay();
      assert.equal(readReplyPaceOverlay(), true);
      clearReplyPace(markCleared);
      assert.equal(readReplyPaceOverlay(), false);
    }
  }).catch(assert.fail);

  it("clears only the overlay marker", (t) => {
    const stored = new Map<string, string>();
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
    t.after(() => {
      if (storageDescriptor) Object.defineProperty(globalThis, "sessionStorage", storageDescriptor);
      else Reflect.deleteProperty(globalThis, "sessionStorage");
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      else Reflect.deleteProperty(globalThis, "window");
    });
    stored.set("x-copilot-reply-pace-until", "1700000060000");
    armReplyPaceOverlay();
    clearReplyPaceOverlay();
    assert.equal(readReplyPaceOverlay(), false);
    assert.equal(stored.get("x-copilot-reply-pace-until"), "1700000060000");
  }).catch(assert.fail);

});

