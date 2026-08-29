import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXCLUDED_ACCOUNTS,
  DEFAULT_EXCLUDED_TAGS,
  DEFAULT_SETTINGS,
  LEGACY_DEFAULT_EXCLUDED_ACCOUNTS,
  LEGACY_DEFAULT_EXCLUDED_TAGS_PRE_CONFLICT,
  MAX_AVOID_CHARS,
  normalizeAvoidPrompt,
  clampMaxThreadChars,
  clampTargetCoolThreads,
  formatExcludedTagsText,
  loadSettings,
  normalizeExcludedAccounts,
  normalizeExcludedTags,
  normalizePreferredLanguage,
  normalizeSettings,
  normalizeTagToken,
  parseExcludedTagsText,
  saveSettings,
  SETTINGS_STORAGE_KEY,
  threadHasExcludedTag,
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
  it("clamps to 1–20 and defaults invalid values", () => {
    assert.equal(clampTargetCoolThreads(8), 8);
    assert.equal(clampTargetCoolThreads(0), 1);
    assert.equal(clampTargetCoolThreads(20), 20);
    assert.equal(clampTargetCoolThreads(21), 20);
    assert.equal(clampTargetCoolThreads(3.5), 5);
  });
});

describe("normalizePreferredLanguage", () => {
  it("defaults unknown codes to en", () => {
    assert.equal(normalizePreferredLanguage("en"), "en");
    assert.equal(normalizePreferredLanguage("FR"), "fr");
    assert.equal(normalizePreferredLanguage("zz"), "en");
    assert.equal(normalizePreferredLanguage(null), "en");
  });
});

describe("excludedTags settings", () => {
  it("strips trailing underscores (so Settings must draft raw text)", () => {
    // Controlled textarea must not re-normalize on every keystroke — otherwise
    // typing `genuine_question` dies at the `_`.
    assert.equal(normalizeTagToken("genuine_"), "genuine");
    assert.equal(normalizeTagToken("genuine "), "genuine");
  });

  it("normalizes tokens and flexible text parse", () => {
    assert.equal(
      normalizeTagToken("Supportive Encouragement"),
      "supportive_encouragement",
    );
    assert.deepEqual(normalizeExcludedTags(undefined), [...DEFAULT_EXCLUDED_TAGS]);
    assert.deepEqual(normalizeExcludedTags([]), []);
    assert.deepEqual(
      parseExcludedTagsText("supportive encouragement\npromo\n"),
      ["supportive_encouragement", "promo"],
    );
    assert.deepEqual(parseExcludedTagsText("tag1, tag2, political"), [
      "tag1",
      "tag2",
      "political",
    ]);
    assert.deepEqual(
      parseExcludedTagsText("tag1,\n  tag2\npolitical,  "),
      ["tag1", "tag2", "political"],
    );
    assert.equal(
      formatExcludedTagsText(["supportive_encouragement", "political"]),
      "supportive_encouragement, political",
    );
    assert.equal(
      threadHasExcludedTag(
        { intent: "supportive encouragement", flags: ["genuine_question"] },
        ["supportive_encouragement"],
      ),
      true,
    );
    assert.equal(
      threadHasExcludedTag(
        { intent: "election dunk", flags: ["political"] },
        ["political"],
      ),
      true,
    );
  });

  it("defaults missing excludedTags key, preserves explicit list and empty", () => {
    assert.deepEqual(normalizeSettings({}).excludedTags, [
      ...DEFAULT_EXCLUDED_TAGS,
    ]);
    assert.deepEqual(
      normalizeSettings({ excludedTags: ["supportive_encouragement"] })
        .excludedTags,
      ["supportive_encouragement"],
    );
    assert.deepEqual(normalizeSettings({ excludedTags: [] }).excludedTags, []);
  });

  it("defaults missing excludedAccounts and preserves an explicit empty list", () => {
    assert.deepEqual(normalizeSettings({}).excludedAccounts, [
      ...DEFAULT_EXCLUDED_ACCOUNTS,
    ]);
    assert.ok(normalizeSettings({}).excludedAccounts.includes("grok"));
    assert.ok(normalizeSettings({}).excludedAccounts.includes("boardyai"));
    assert.deepEqual(
      normalizeExcludedAccounts(["@Grok", "not a handle"]),
      ["grok"],
    );
    assert.deepEqual(normalizeSettings({ excludedAccounts: [] }).excludedAccounts, []);
  });
});

describe("normalizeSettings", () => {
  it("fills defaults for bad input", () => {
    assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
    assert.deepEqual(
      normalizeSettings({
        maxThreadChars: 320,
        dropArticles: false,
        dropOutboundLinks: false,
        dropEmDashes: false,
        dropProfanity: false,
        dropAutomatedAccounts: false,
        targetCoolThreads: 3,
        dedupeAccounts: false,
        preferredLanguage: "es",
        excludedTags: ["promo"],
        avoidPrompt: "  skip dunking  ",
      }),
      {
        maxThreadChars: 320,
        dropArticles: false,
        dropOutboundLinks: false,
        dropEmDashes: false,
        dropProfanity: false,
        dropAutomatedAccounts: false,
        targetCoolThreads: 3,
        dedupeAccounts: false,
        preferredLanguage: "es",
        excludedTags: ["promo"],
        excludedAccounts: [...DEFAULT_EXCLUDED_ACCOUNTS],
        avoidPrompt: "skip dunking",
      },
    );
    assert.equal(normalizeSettings({}).dedupeAccounts, true);
    assert.equal(normalizeSettings({}).preferredLanguage, "en");
    assert.equal(normalizeSettings({}).dropEmDashes, true);
    assert.equal(normalizeSettings({}).dropOutboundLinks, true);
    assert.equal(normalizeSettings({}).dropProfanity, true);
    assert.equal(normalizeSettings({}).dropAutomatedAccounts, true);
    assert.equal(normalizeSettings({}).avoidPrompt, "");
    assert.deepEqual(DEFAULT_EXCLUDED_TAGS, [
      "supportive_encouragement",
      "political",
      "interpersonal_conflict",
    ]);
    assert.equal(normalizeAvoidPrompt("x".repeat(MAX_AVOID_CHARS + 20)).length, MAX_AVOID_CHARS);
    const stored = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    delete stored.dropOutboundLinks;
    assert.equal(normalizeSettings(stored).dropOutboundLinks, true);
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
      dropOutboundLinks: false,
      dropEmDashes: false,
      dropProfanity: false,
      dropAutomatedAccounts: false,
      targetCoolThreads: 5,
      dedupeAccounts: false,
      preferredLanguage: "fr",
      excludedTags: ["supportive_encouragement", "political", "promo"],
      excludedAccounts: [...DEFAULT_EXCLUDED_ACCOUNTS],
      avoidPrompt: "skip beginner dunking",
    });
    assert.deepEqual(saved, {
      maxThreadChars: 320,
      dropArticles: false,
      dropOutboundLinks: false,
      dropEmDashes: false,
      dropProfanity: false,
      dropAutomatedAccounts: false,
      targetCoolThreads: 5,
      dedupeAccounts: false,
      preferredLanguage: "fr",
      excludedTags: ["supportive_encouragement", "political", "promo"],
      excludedAccounts: [...DEFAULT_EXCLUDED_ACCOUNTS],
      avoidPrompt: "skip beginner dunking",
    });
    assert.deepEqual(loadSettings(), saved);
    assert.ok(localStorage.getItem(SETTINGS_STORAGE_KEY));
  });

  it("returns defaults when empty", () => {
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  });

  it("upgrades the legacy default list only when loading", () => {
    store.set(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        excludedTags: ["supportive_encouragement"],
      }),
    );
    assert.deepEqual(loadSettings().excludedTags, [...DEFAULT_EXCLUDED_TAGS]);
  });

  it("upgrades the pre-conflict default pair on load", () => {
    store.set(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        excludedTags: [...LEGACY_DEFAULT_EXCLUDED_TAGS_PRE_CONFLICT],
      }),
    );
    assert.deepEqual(loadSettings().excludedTags, [...DEFAULT_EXCLUDED_TAGS]);
  });

  it("does not re-expand a legacy-shaped list when saving", () => {
    const saved = saveSettings({
      ...DEFAULT_SETTINGS,
      excludedTags: ["supportive_encouragement"],
    });
    assert.deepEqual(saved.excludedTags, ["supportive_encouragement"]);
    assert.deepEqual(
      JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!),
      saved,
    );
  });

  it("does not re-add interpersonal_conflict on reload after an explicit save that removed it", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      excludedTags: ["supportive_encouragement"],
    });
    assert.deepEqual(loadSettings().excludedTags, [
      "supportive_encouragement",
    ]);
  });

  it("keeps a deliberate save that removed only the conflict chip", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      excludedTags: [...LEGACY_DEFAULT_EXCLUDED_TAGS_PRE_CONFLICT],
    });
    assert.deepEqual(loadSettings().excludedTags, [
      ...LEGACY_DEFAULT_EXCLUDED_TAGS_PRE_CONFLICT,
    ]);
  });

  it("adds boardyai when stored accounts are still the previous default", () => {
    store.set(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        excludedAccounts: [...LEGACY_DEFAULT_EXCLUDED_ACCOUNTS],
      }),
    );
    assert.deepEqual(loadSettings().excludedAccounts, [
      ...DEFAULT_EXCLUDED_ACCOUNTS,
    ]);
  });

  it("does not re-add boardyai after an explicit save without it", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      excludedAccounts: [...LEGACY_DEFAULT_EXCLUDED_ACCOUNTS],
    });
    assert.deepEqual(loadSettings().excludedAccounts, [
      ...LEGACY_DEFAULT_EXCLUDED_ACCOUNTS,
    ]);
  });
});
