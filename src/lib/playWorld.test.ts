import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PLAY_YARD,
  aimMove,
  cameraFollow,
  playToastFromMissions,
  stepMove,
} from "./playWorld.ts";

describe("playWorld", () => {
  it("walks forward and stops at the yard fence", () => {
    const mid = stepMove({ x: 0, z: 0 }, { x: 0, z: 1 }, 0.25, 0);
    assert.equal(mid.moving, true);
    assert.ok(mid.pos.z > 0);
    const edge = stepMove({ x: 0, z: PLAY_YARD }, { x: 0, z: 1 }, 1, 0);
    assert.ok(Math.abs(aimMove({ x: 0, z: 1 }, 0).z) > 0.5);
    assert.equal(edge.pos.z, PLAY_YARD);
  });

  it("keeps the camera behind the player", () => {
    const cam = cameraFollow({ x: 0, z: 0 }, 0);
    assert.ok(cam.z > 0);
    assert.equal(cam.lookX, 0);
  });

  it("toasts a newly claimed mission once", () => {
    const prev = [
      { id: "original_1", label: "Post 1 original", progress: 0, target: 1, claimed: false },
    ];
    const next = [
      { id: "original_1", label: "Post 1 original", progress: 1, target: 1, claimed: true },
    ];
    assert.equal(playToastFromMissions(prev, next), "Post 1 original claimed");
    assert.equal(playToastFromMissions(next, next), null);
  });
});
