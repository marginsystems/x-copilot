import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPublicView, pathFromView, viewFromPath } from "./appView.ts";

describe("desk routes", () => {
  it("keeps Account, Settings, and Usage on separate paths", () => {
    assert.equal(viewFromPath("/account"), "account");
    assert.equal(viewFromPath("/settings"), "settings");
    assert.equal(viewFromPath("/usage"), "usage");
    assert.equal(viewFromPath("/billing"), "usage");
    assert.notEqual(viewFromPath("/account"), viewFromPath("/settings"));
    assert.notEqual(viewFromPath("/account"), viewFromPath("/usage"));
    assert.notEqual(viewFromPath("/settings"), viewFromPath("/usage"));
    assert.equal(pathFromView("account"), "/account");
    assert.equal(pathFromView("settings"), "/settings");
    assert.equal(pathFromView("usage"), "/usage");
  });

  it("does not treat legal or scout panes as account", () => {
    assert.equal(viewFromPath("/privacy"), "privacy");
    assert.equal(viewFromPath("/terms"), "terms");
    assert.equal(viewFromPath("/pricing"), "pricing");
    assert.equal(pathFromView("pricing"), "/pricing");
    assert.equal(viewFromPath("/changelog"), "changelog");
    assert.equal(pathFromView("changelog"), "/changelog");
    assert.equal(viewFromPath("/learn"), "learn");
    assert.equal(pathFromView("learn"), "/learn");
    assert.equal(viewFromPath("/learn/what-a-like-is-worth"), "learnWeights");
    assert.equal(pathFromView("learnWeights"), "/learn/what-a-like-is-worth");
    assert.equal(viewFromPath("/learn/posts-that-get-a-reply"), "learnReply");
    assert.equal(pathFromView("learnReply"), "/learn/posts-that-get-a-reply");
    assert.equal(viewFromPath("/learn/how-many-replies"), "learnVolume");
    assert.equal(pathFromView("learnVolume"), "/learn/how-many-replies");
    assert.equal(viewFromPath("/learn/likes-and-follows-you-give"), "learnGive");
    assert.equal(pathFromView("learnGive"), "/learn/likes-and-follows-you-give");
    assert.equal(viewFromPath("/learn/follow"), "learnFollow");
    assert.equal(pathFromView("learnFollow"), "/learn/follow");
    assert.equal(viewFromPath("/analytics"), "analytics");
    assert.equal(viewFromPath("/voice"), "voice");
    assert.equal(viewFromPath("/play"), "dashboard");
    assert.equal(viewFromPath("/play/"), "dashboard");
    assert.equal(viewFromPath("/"), "home");
    assert.equal(viewFromPath("/dashboard"), "dashboard");
    assert.equal(pathFromView("home"), "/");
    assert.equal(pathFromView("dashboard"), "/dashboard");
  });

  it("treats legal, pricing, changelog, and learn as public", () => {
    assert.equal(isPublicView("privacy"), true);
    assert.equal(isPublicView("terms"), true);
    assert.equal(isPublicView("pricing"), true);
    assert.equal(isPublicView("changelog"), true);
    assert.equal(isPublicView("learn"), true);
    assert.equal(isPublicView("learnWeights"), true);
    assert.equal(isPublicView("learnReply"), true);
    assert.equal(isPublicView("learnVolume"), true);
    assert.equal(isPublicView("learnGive"), true);
    assert.equal(isPublicView("learnFollow"), true);
    assert.equal(isPublicView("dashboard"), false);
    assert.equal(isPublicView("home"), false);
  });
});
