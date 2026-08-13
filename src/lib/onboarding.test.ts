import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ONBOARDING_STORAGE_KEY,
  labelsFor,
  parseGeneratedAgendas,
  readOnboardingComplete,
  TOPIC_OPTIONS,
  toggleId,
  writeOnboardingComplete,
} from "./onboarding.ts";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  },
});

describe("onboarding helpers", () => {
  beforeEach(() => store.clear());

  it("toggles chip ids", () => {
    assert.deepEqual(toggleId(["ai"], "software"), ["ai", "software"]);
    assert.deepEqual(toggleId(["ai", "software"], "ai"), ["software"]);
  });

  it("maps selected ids to labels", () => {
    assert.deepEqual(labelsFor(["ai", "nope"], TOPIC_OPTIONS), [
      "AI & machine learning",
    ]);
  });

  it("persists a local completion flag", () => {
    assert.equal(readOnboardingComplete(), false);
    writeOnboardingComplete();
    assert.equal(readOnboardingComplete(), true);
    assert.equal(store.get(ONBOARDING_STORAGE_KEY), "1");
  });

  it("parses generated agenda cards", () => {
    const body =
      "Find builders sharing opinions on shipping. Prefer a point of view. Skip empty polls.";
    const parsed = parseGeneratedAgendas([
      { title: "A", body, recommended: false },
      { title: "B", body, recommended: true },
      { title: "C", body: "short" },
    ]);
    assert.equal(parsed?.length, 2);
    assert.equal(parsed?.[1].recommended, true);
    assert.equal(parseGeneratedAgendas([{ title: "A", body }]), null);
  });
});
