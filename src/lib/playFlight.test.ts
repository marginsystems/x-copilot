import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CIRCUIT_GATES,
  FLIGHT,
  chaseCamera,
  hitGate,
  nextGateIndex,
  parkedFlight,
  stepFlight,
} from "./playFlight.ts";

describe("playFlight", () => {
  it("stays parked without throttle and never invents altitude", () => {
    const parked = parkedFlight();
    const still = stepFlight(parked, { throttle: false, bank: 0 }, 0.5);
    assert.equal(still.airborne, false);
    assert.equal(still.y, 0);
    assert.equal(still.speed, 0);
  });

  it("rolls then lifts after enough hold, then lands when you let go", () => {
    let s = parkedFlight();
    for (let i = 0; i < 40; i += 1) {
      s = stepFlight(s, { throttle: true, bank: 0 }, 0.05);
    }
    assert.equal(s.airborne, true);
    assert.ok(s.y > 0);
    assert.ok(s.z < FLIGHT.startZ);
    for (let i = 0; i < 160; i += 1) {
      s = stepFlight(s, { throttle: false, bank: 0 }, 0.05);
    }
    assert.equal(s.airborne, false);
    assert.equal(s.y, 0);
  });

  it("banks left and turns without writing a score", () => {
    let s = parkedFlight();
    for (let i = 0; i < 30; i += 1) {
      s = stepFlight(s, { throttle: true, bank: 0 }, 0.05);
    }
    const airborne = s;
    for (let i = 0; i < 20; i += 1) {
      s = stepFlight(s, { throttle: true, bank: -1 }, 0.05);
    }
    assert.ok(s.yaw < airborne.yaw);
    const text = readFileSync(new URL("./playFlight.ts", import.meta.url), "utf8");
    assert.equal(/lifetimeXp|billingQuotas|credits/i.test(text), false);
  });

  it("hits a gate only inside the ring and walks the circuit", () => {
    const gate = CIRCUIT_GATES[0];
    const miss = { ...parkedFlight(), x: 40, y: 0, z: 40 };
    const hit = { ...parkedFlight(), x: gate.x, y: gate.y, z: gate.z };
    assert.equal(hitGate(miss, gate), false);
    assert.equal(hitGate(hit, gate), true);
    assert.equal(nextGateIndex([true, false, false, false]), 1);
    assert.equal(nextGateIndex([true, true, true, true]), 4);
    const cam = chaseCamera(parkedFlight());
    assert.ok(cam.z > parkedFlight().z);
  });
});
