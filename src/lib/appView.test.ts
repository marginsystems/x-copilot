import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pathFromView, viewFromPath } from "./appView.ts";

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
    assert.equal(viewFromPath("/analytics"), "analytics");
    assert.equal(viewFromPath("/voice"), "voice");
    assert.equal(viewFromPath("/"), "home");
    assert.equal(viewFromPath("/dashboard"), "dashboard");
    assert.equal(pathFromView("home"), "/");
    assert.equal(pathFromView("dashboard"), "/dashboard");
  });
});
