import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DIAL_CX,
  DIAL_CY,
  DIAL_VIEW_HEIGHT,
  DIAL_VIEW_WIDTH,
  arcLabelPoint,
  needleTouchesBox,
  sweptNeedleTouchesBox,
  valueTextBox,
} from "./gaugeLayout.ts";
import { GAUGE_END_DEG, GAUGE_START_DEG } from "./gaugeGeometry.ts";

const WIDEST_VALUES = ["0.52", "3 / 20", "16 / 10", "12 / 20", "Clear", "Mixed", "Quiet", "–"];

await describe("gaugeLayout", () => {
  it("never lets the swept needle, tail or hub reach any value text", () => {
    for (const text of WIDEST_VALUES) {
      assert.equal(sweptNeedleTouchesBox(valueTextBox(text)), false, text);
    }
  }).catch(assert.fail);

  it("checks min, mid and max needle positions", () => {
    const box = valueTextBox("12 / 20");
    for (const deg of [GAUGE_START_DEG, -90, GAUGE_END_DEG]) {
      assert.equal(needleTouchesBox(deg, box), false, String(deg));
    }
  }).catch(assert.fail);

  it("detects a real collision so the check is not vacuous", () => {
    const overlapping = { left: 40, right: 60, top: DIAL_CY - 5, bottom: DIAL_CY + 8 };
    assert.equal(sweptNeedleTouchesBox(overlapping), true);
    assert.equal(needleTouchesBox(-90, { left: 45, right: 55, top: 10, bottom: 30 }), true);
  }).catch(assert.fail);

  it("keeps the value text inside the view box and clear of the arc-end labels", () => {
    for (const text of WIDEST_VALUES) {
      const box = valueTextBox(text);
      assert.ok(box.left >= 0 && box.right <= DIAL_VIEW_WIDTH, text);
      assert.ok(box.bottom <= DIAL_VIEW_HEIGHT, text);
    }
    const box = valueTextBox("12 / 20");
    for (const deg of [GAUGE_START_DEG, GAUGE_END_DEG]) {
      const at = arcLabelPoint(deg);
      assert.ok(at.y + 4 < box.top, "label sits above the value");
    }
    assert.ok(box.top > DIAL_CY + 20);
    assert.equal(DIAL_CX, DIAL_VIEW_WIDTH / 2);
  }).catch(assert.fail);
});
