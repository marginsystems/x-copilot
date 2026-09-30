import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GAUGE_END_DEG,
  GAUGE_START_DEG,
  arcPath,
  fractionToAngle,
  gaugeFraction,
  gaugeHasValue,
  gaugeTicks,
  niceCeil,
  polarPoint,
  toneAt,
  valueToAngle,
  zoneFractions,
} from "./gaugeGeometry.ts";

function close(actual: number, expected: number, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} != ${expected}`);
}

await describe("gaugeGeometry", () => {
  it("sweeps 240 degrees from -210 to 30", () => {
    assert.equal(GAUGE_START_DEG, -210);
    assert.equal(GAUGE_END_DEG, 30);
    assert.equal(valueToAngle(0, 0, 10), -210);
    assert.equal(valueToAngle(10, 0, 10), 30);
    close(valueToAngle(5, 0, 10), -90);
  }).catch(assert.fail);

  it("clamps out-of-range values to the ends", () => {
    assert.equal(valueToAngle(-4, 0, 10), -210);
    assert.equal(valueToAngle(99, 0, 10), 30);
    assert.equal(gaugeFraction(15, 0, 10), 1);
    assert.equal(fractionToAngle(2), 30);
    assert.equal(fractionToAngle(-1), -210);
  }).catch(assert.fail);

  it("draws an empty dial for NaN, infinite, null or undefined values", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      assert.equal(gaugeFraction(value, 0, 10), 0);
      assert.equal(valueToAngle(value, 0, 10), -210);
      assert.equal(gaugeHasValue(value), false);
    }
    assert.equal(gaugeHasValue(0), true);
  }).catch(assert.fail);

  it("treats a degenerate scale as empty", () => {
    assert.equal(gaugeFraction(3, 5, 5), 0);
    assert.equal(gaugeFraction(3, 10, 0), 0);
    assert.equal(gaugeFraction(3, Number.NaN, 10), 0);
  }).catch(assert.fail);

  it("places points clockwise from east in screen space", () => {
    const east = polarPoint(50, 50, 10, 0);
    close(east.x, 60);
    close(east.y, 50);
    const top = polarPoint(50, 50, 10, -90);
    close(top.x, 50);
    close(top.y, 40);
    const start = polarPoint(50, 50, 10, -210);
    close(start.x, 50 - 10 * Math.cos(Math.PI / 6));
    close(start.y, 55);
  }).catch(assert.fail);

  it("builds tick positions with majors at segment edges", () => {
    const ticks = gaugeTicks(2, 3);
    assert.equal(ticks.length, 9);
    assert.deepEqual(ticks.filter((t) => t.major).map((t) => t.fraction), [0, 0.5, 1]);
    assert.equal(ticks[0]!.deg, -210);
    assert.equal(ticks[8]!.deg, 30);
    close(ticks[4]!.deg, -90);
    assert.equal(gaugeTicks(0, -2).length, 2);
  }).catch(assert.fail);

  it("uses the large-arc flag past 180 degrees", () => {
    assert.match(arcPath(50, 50, 30, -210, 30), / 0 1 1 /);
    assert.match(arcPath(50, 50, 30, -210, -100), / 0 0 1 /);
  }).catch(assert.fail);

  it("maps zones to fractions and finds the tone at a value", () => {
    const zones = [
      { from: 0, to: 2, tone: "danger" as const },
      { from: 9, to: 10, tone: "warn" as const },
      { from: 4, to: 4, tone: "gain" as const },
    ];
    assert.deepEqual(zoneFractions(zones, 0, 10), [
      { from: 0, to: 0.2, tone: "danger" },
      { from: 0.9, to: 1, tone: "warn" },
    ]);
    assert.equal(toneAt(1, zones), "danger");
    assert.equal(toneAt(5, zones), null);
    assert.equal(toneAt(10, zones), "warn");
    assert.equal(toneAt(Number.NaN, zones), null);
  }).catch(assert.fail);

  it("rounds a scale up to the next step with headroom", () => {
    assert.equal(niceCeil(0.54, [1, 2, 5]), 1);
    assert.equal(niceCeil(15, [10, 20, 50]), 20);
    assert.equal(niceCeil(17, [10, 20, 50]), 50);
    assert.equal(niceCeil(0, [10, 20, 50]), 10);
    assert.equal(niceCeil(Number.NaN, [10, 20, 50]), 10);
    assert.equal(niceCeil(999, [10, 20, 50]), 50);
  }).catch(assert.fail);
});
