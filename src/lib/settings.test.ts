import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  clampMaxThreadChars,
  clampTargetCoolThreads,
  loadSettings,
  normalizeSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY,
} from "./settings.ts";

const store = new Map<string, string>();

const localStorageMock = {
  getItem(key: string) {
    return store.has(key) ? store.get(key)! : null;
  },
  setItem(key: string, value: string) {
    store.set(key, value);
  },
  clear() {
    store.clear();
  },
  removeItem(key: string) {
    store.delete(key);
  },
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

describe("clampMaxThreadChars", () => {
  it("clamps to range and rejects non-integers", () => {
    assert.equal(clampMaxThreadChars(480), 480);
    assert.equal(clampMaxThreadChars(50), 120);
    assert.equal(clampMaxThreadChars(5000), 2000);
    assert.equal(clampMaxThreadChars(12.5), 480);
    assert.equal(clampMaxThreadChars("abc"), 480);
  });
});

describe("clampTargetCoolThreads", () => {
  it("clamps to 1–10 and defaults invalid values", () => {
    assert.equal(clampTargetCoolThreads(8), 8);
    assert.equal(clampTargetCoolThreads(0), 1);
    assert.equal(clampTargetCoolThreads(11), 10);
    assert.equal(clampTargetCoolThreads(3.5), 8);
  });
});

describe("normalizeSettings", () => {
  it("fills defaults for bad input", () => {
    assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
    assert.deepEqual(
      normalizeSettings({
        maxThreadChars: 320,
        dropArticles: false,
        targetCoolThreads: 3,
      }),
      {
        maxThreadChars: 320,
        dropArticles: false,
        targetCoolThreads: 3,
      },
    );
  });
});

describe("loadSettings / saveSettings", () => {
  beforeEach(() => {
    store.clear();
  });

  it("round-trips through localStorage", () => {
    const saved = saveSettings({
      maxThreadChars: 320,
      dropArticles: false,
      targetCoolThreads: 5,
    });
    assert.deepEqual(saved, {
      maxThreadChars: 320,
      dropArticles: false,
      targetCoolThreads: 5,
    });
    assert.deepEqual(loadSettings(), saved);
    assert.ok(localStorage.getItem(SETTINGS_STORAGE_KEY));
  });

  it("returns defaults when empty", () => {
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  });
});
