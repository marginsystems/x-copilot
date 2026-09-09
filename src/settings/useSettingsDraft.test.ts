import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../lib/settings.ts";
import { commitSettingsDraft } from "./useSettingsDraft.ts";

const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);

afterEach(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

describe("commitSettingsDraft", () => {
  it("saves settings without rewriting parked threads", () => {
    const stored = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    });
    const parked = [{ id: "parked", views: 1, flags: ["political"] }];
    let settingsUpdates = 0;

    const saved = commitSettingsDraft(
      {
        ...DEFAULT_SETTINGS,
        minViews: 10_000,
        excludedTags: ["political"],
      },
      {
        setSettings: () => {
          settingsUpdates += 1;
        },
      },
    );

    assert.equal(saved.minViews, 10_000);
    assert.equal(settingsUpdates, 1);
    assert.deepEqual(parked.map((thread) => thread.id), ["parked"]);
  });
});
