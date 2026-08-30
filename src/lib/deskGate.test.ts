import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deskNeedsXLink, showDeskXGate } from "./deskGate.ts";

describe("deskNeedsXLink", () => {
  it("is true only for a signed-in user without official X OAuth", () => {
    assert.equal(deskNeedsXLink(null), false);
    assert.equal(deskNeedsXLink(undefined), false);
    assert.equal(deskNeedsXLink({ xLinked: true }), false);
    assert.equal(deskNeedsXLink({ xLinked: false }), true);
    assert.equal(deskNeedsXLink({}), true);
  });
});

describe("showDeskXGate", () => {
  const base = {
    needsXLink: true,
    needsLogin: false,
    needsOnboarding: false,
    legalView: false,
    showLanding: false,
    view: "dashboard",
  };

  it("blocks the desk when X is missing", () => {
    assert.equal(showDeskXGate(base), true);
    assert.equal(showDeskXGate({ ...base, view: "settings" }), true);
    assert.equal(showDeskXGate({ ...base, view: "voice" }), true);
    assert.equal(showDeskXGate({ ...base, view: "analytics" }), true);
  });

  it("keeps Account, Usage, and Admin reachable", () => {
    assert.equal(showDeskXGate({ ...base, view: "account" }), false);
    assert.equal(showDeskXGate({ ...base, view: "usage" }), false);
    assert.equal(showDeskXGate({ ...base, view: "admin" }), false);
  });

  it("does not replace landing, legal, login, or first-run onboarding", () => {
    assert.equal(showDeskXGate({ ...base, showLanding: true }), false);
    assert.equal(showDeskXGate({ ...base, legalView: true }), false);
    assert.equal(showDeskXGate({ ...base, view: "pricing" }), false);
    assert.equal(showDeskXGate({ ...base, view: "changelog" }), false);
    assert.equal(showDeskXGate({ ...base, view: "learn" }), false);
    assert.equal(showDeskXGate({ ...base, view: "learnWeights" }), false);
    assert.equal(showDeskXGate({ ...base, view: "learnReply" }), false);
    assert.equal(showDeskXGate({ ...base, view: "learnVolume" }), false);
    assert.equal(showDeskXGate({ ...base, view: "learnGive" }), false);
    assert.equal(showDeskXGate({ ...base, view: "learnFollow" }), false);
    assert.equal(showDeskXGate({ ...base, needsLogin: true }), false);
    assert.equal(showDeskXGate({ ...base, needsOnboarding: true }), false);
    assert.equal(showDeskXGate({ ...base, needsXLink: false }), false);
  });
});
