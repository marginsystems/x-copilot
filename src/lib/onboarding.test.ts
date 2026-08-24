import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ONBOARDING_AGENDA_KEY,
  ONBOARDING_STORAGE_KEY,
  agendaSeedFromStored,
  consumeOnboardingPreviewQuery,
  labelsFor,
  needsOnboardingWizard,
  onboardingPostsComplete,
  onboardingWritesLocalStorage,
  parseGeneratedAgendas,
  readOnboardingAgenda,
  readOnboardingComplete,
  resolveOnboardingMode,
  TOPIC_OPTIONS,
  toggleId,
  writeOnboardingAgenda,
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

  it("scopes completion and agenda per user id", () => {
    writeOnboardingComplete("user A's agenda", "user-a");
    assert.equal(readOnboardingComplete("user-a"), true);
    assert.equal(readOnboardingComplete("user-b"), false);
    assert.equal(readOnboardingAgenda("user-a"), "user A's agenda");
    assert.equal(readOnboardingAgenda("user-b"), null);
    writeOnboardingComplete("user B's agenda", "user-b");
    assert.equal(readOnboardingAgenda("user-a"), "user A's agenda");
    assert.equal(readOnboardingAgenda("user-b"), "user B's agenda");
  });

  it("carries a landing agenda through sign-in without marking setup complete", () => {
    const agenda =
      "Find builders discussing practical AI tools. Prefer concrete tradeoffs and skip generic engagement prompts.";
    writeOnboardingAgenda(agenda);
    assert.equal(readOnboardingComplete(), false);
    assert.equal(readOnboardingAgenda(), agenda);
    assert.equal(readOnboardingAgenda("user-a"), agenda);
    assert.equal(readOnboardingComplete("user-a"), false);
    assert.equal(store.has(ONBOARDING_AGENDA_KEY), false);
    assert.equal(store.get(`${ONBOARDING_AGENDA_KEY}:user-a`), agenda);
  });

  it("clears a stale landing agenda when the signed-in user has a scoped one", () => {
    writeOnboardingComplete("user A's agenda", "user-a");
    writeOnboardingAgenda("landing pick");
    assert.equal(readOnboardingAgenda("user-a"), "user A's agenda");
    assert.equal(store.has(ONBOARDING_AGENDA_KEY), false);
    assert.equal(store.get(`${ONBOARDING_AGENDA_KEY}:user-a`), "user A's agenda");
  });

  it("turns a carried agenda into the signed-in confirmation step", () => {
    const agenda =
      "Find builders discussing practical AI tools. Prefer concrete tradeoffs and skip generic engagement prompts.";
    assert.deepEqual(agendaSeedFromStored(`  ${agenda}  `), {
      title: "Your agenda",
      body: agenda,
      recommended: true,
    });
    assert.equal(agendaSeedFromStored("too short"), null);
  });

  it("migrates a prior local setup to the first signed-in account", () => {
    writeOnboardingComplete("local agenda");
    assert.equal(readOnboardingComplete(), true);
    assert.equal(readOnboardingComplete("user-a"), true);
    assert.equal(readOnboardingAgenda("user-a"), "local agenda");
    assert.equal(store.has(ONBOARDING_STORAGE_KEY), false);
    assert.equal(store.has(ONBOARDING_AGENDA_KEY), false);
    assert.equal(readOnboardingComplete("user-b"), false);
    assert.equal(readOnboardingAgenda("user-b"), null);
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

  it("preview mode writes nothing — persist=false still would", () => {
    assert.equal(resolveOnboardingMode(undefined, false), "local");
    assert.equal(resolveOnboardingMode(undefined, true), "real");
    assert.equal(resolveOnboardingMode("preview", true), "preview");
    assert.equal(onboardingPostsComplete("real"), true);
    assert.equal(onboardingPostsComplete("local"), false);
    assert.equal(onboardingPostsComplete("preview"), false);
    assert.equal(onboardingWritesLocalStorage("real"), true);
    assert.equal(onboardingWritesLocalStorage("local"), true);
    assert.equal(onboardingWritesLocalStorage("preview"), false);
  });

  it("uses the server onboarding flag when a session exists", () => {
    const base = {
      needsLogin: false,
      onboardingDoneLocal: false,
      localComplete: true,
    };
    assert.equal(
      needsOnboardingWizard({
        ...base,
        authUser: { onboardingCompleted: false },
      }),
      true,
    );
    assert.equal(
      needsOnboardingWizard({
        ...base,
        authUser: { onboardingCompleted: true },
        localComplete: false,
      }),
      false,
    );
    assert.equal(
      needsOnboardingWizard({ ...base, authUser: null }),
      false,
    );
    assert.equal(
      needsOnboardingWizard({
        ...base,
        authUser: null,
        localComplete: false,
      }),
      true,
    );
    assert.equal(
      needsOnboardingWizard({
        ...base,
        needsLogin: true,
        authUser: { onboardingCompleted: false },
      }),
      false,
    );
    assert.equal(
      needsOnboardingWizard({
        ...base,
        onboardingDoneLocal: true,
        authUser: { onboardingCompleted: false },
        localComplete: false,
      }),
      false,
    );
  });

  it("opens admin preview from the query and strips the flag so reload exits", () => {
    assert.deepEqual(
      consumeOnboardingPreviewQuery("?onboarding=preview", false),
      { open: false, nextSearch: "?onboarding=preview" },
    );
    assert.deepEqual(consumeOnboardingPreviewQuery("?onboarding=preview", true), {
      open: true,
      nextSearch: "",
    });
    assert.deepEqual(
      consumeOnboardingPreviewQuery("?onboarding=preview&tab=grants", true),
      { open: true, nextSearch: "?tab=grants" },
    );
  });
});
