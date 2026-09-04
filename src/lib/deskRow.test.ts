import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deskRowExpandMount,
  deskRowExpandOpen,
  deskRowInitialPhase,
  deskRowPhaseAfterEnter,
  deskRowPhaseAfterLeave,
  deskRowPhaseOnOpenChange,
} from "./deskRow.ts";

describe("deskRow expand phase", () => {
  it("starts closed or already open so first paint does not animate in", () => {
    assert.equal(deskRowInitialPhase(false), "closed");
    assert.equal(deskRowInitialPhase(true), "open");
    assert.equal(deskRowExpandMount("closed"), false);
    assert.equal(deskRowExpandOpen("open"), true);
  });

  it("opens through entering so the 0fr slot can paint before 1fr", () => {
    assert.equal(deskRowPhaseOnOpenChange("closed", true), "entering");
    assert.equal(deskRowExpandMount("entering"), true);
    assert.equal(deskRowExpandOpen("entering"), false);
    assert.equal(deskRowPhaseAfterEnter("entering"), "open");
    assert.equal(deskRowPhaseOnOpenChange("open", true), "open");
  });

  it("closes through leaving so collapse can play before unmount", () => {
    assert.equal(deskRowPhaseOnOpenChange("open", false), "leaving");
    assert.equal(deskRowExpandMount("leaving"), true);
    assert.equal(deskRowExpandOpen("leaving"), false);
    assert.equal(deskRowPhaseAfterLeave("leaving"), "closed");
    assert.equal(deskRowPhaseOnOpenChange("closed", false), "closed");
  });

  it("reverses mid-flight without getting stuck", () => {
    assert.equal(deskRowPhaseOnOpenChange("entering", false), "leaving");
    assert.equal(deskRowPhaseOnOpenChange("leaving", true), "entering");
    assert.equal(deskRowPhaseAfterEnter("open"), "open");
    assert.equal(deskRowPhaseAfterLeave("closed"), "closed");
  });
});
