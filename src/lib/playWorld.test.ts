import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PLAY_ORBIT,
  autoOrbit,
  cameraFromOrbit,
  clampOrbit,
  defaultOrbit,
  dragOrbit,
  pinchOrbit,
  playToastFromMissions,
} from "./playWorld.ts";

describe("playWorld", () => {
  it("clamps pitch and radius around the parked plane", () => {
    const o = clampOrbit({ yaw: 2, pitch: 4, radius: 200 });
    assert.equal(o.pitch, PLAY_ORBIT.pitchMax);
    assert.equal(o.radius, PLAY_ORBIT.radiusMax);
    assert.equal(clampOrbit({ yaw: 0, pitch: -2, radius: 1 }).pitch, PLAY_ORBIT.pitchMin);
  });

  it("orbits the camera around the origin", () => {
    const start = defaultOrbit();
    const cam = cameraFromOrbit(start);
    assert.equal(cam.lookX, 0);
    assert.equal(cam.lookZ, 0);
    assert.ok(cam.y > 0);
    const dragged = dragOrbit(start, 80, 0);
    assert.ok(dragged.yaw > start.yaw);
    const inClose = pinchOrbit(start, 2);
    assert.ok(inClose.radius < start.radius);
  });

  it("auto-orbits only after ten idle seconds", () => {
    const start = defaultOrbit();
    assert.equal(autoOrbit(start, 1, 3).yaw, start.yaw);
    assert.ok(autoOrbit(start, 1, 11).yaw > start.yaw);
    assert.equal(autoOrbit(start, 1, 11, true).yaw, start.yaw);
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
