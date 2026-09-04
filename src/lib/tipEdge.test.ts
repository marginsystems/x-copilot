import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  estimateTipWidth,
  tipAlignClass,
  tipAnchor,
  tipEdge,
  tipFlipBelow,
} from "./tipEdge.ts";

describe("tipEdge", () => {
  it("stays centered when the panel fits", () => {
    assert.equal(tipEdge(400, 256, 800), "center");
  });

  it("aligns start when a centered panel would clip the left edge", () => {
    assert.equal(tipEdge(40, 256, 800), "start");
  });

  it("aligns start for a left Approach action (Open For You)", () => {
    assert.equal(tipEdge(90, 240, 1100), "start");
  });

  it("aligns end when a centered panel would clip the right edge", () => {
    assert.equal(tipEdge(760, 256, 800), "end");
  });

  it("picks the roomier side when both edges overflow", () => {
    assert.equal(tipEdge(80, 400, 200), "start");
    assert.equal(tipEdge(140, 400, 200), "end");
  });

  it("stays centered when anchoring would push it off the far edge", () => {
    assert.equal(tipEdge(100, 243.2, 320), "center");
    assert.equal(tipEdge(190, 243.2, 320), "center");
  });

  it("anchors when the anchored panel fits the far edge", () => {
    assert.equal(tipEdge(60, 243.2, 320), "start");
    assert.equal(tipEdge(260, 243.2, 320), "end");
  });
});

describe("tipAlignClass", () => {
  it("names the CSS class for each edge", () => {
    assert.equal(tipAlignClass("start"), "is-tip-start");
    assert.equal(tipAlignClass("center"), "is-tip-center");
    assert.equal(tipAlignClass("end"), "is-tip-end");
  });
});

describe("estimateTipWidth", () => {
  it("uses 16rem until 76vw is smaller", () => {
    assert.equal(estimateTipWidth(1200), 240);
    assert.equal(estimateTipWidth(300), 228);
  });
});

describe("tipFlipBelow", () => {
  it("flips when the tip would clip the top of the viewport", () => {
    assert.equal(tipFlipBelow(40, 44), true);
  });

  it("stays above when there is room", () => {
    assert.equal(tipFlipBelow(120, 44), false);
  });
});

describe("tipAnchor", () => {
  it("maps a point from chart viewBox coordinates to fixed viewport coordinates", () => {
    assert.deepEqual(
      tipAnchor(40, 20, 300, 60, 150, 30, 600, 120),
      { x: 115, y: 35 },
    );
  });

  it("scales x by the wrapper's rendered width ratio", () => {
    assert.deepEqual(
      tipAnchor(0, 0, 240, 48, 30, 60, 600, 120),
      { x: 12, y: 24 },
    );
  });
});
