import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateTipWidth, tipEdge } from "./tipEdge.ts";

describe("tipEdge", () => {
  it("stays centered when the panel fits", () => {
    assert.equal(tipEdge(400, 256, 800), "center");
  });

  it("aligns start when a centered panel would clip the left edge", () => {
    assert.equal(tipEdge(40, 256, 800), "start");
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

describe("estimateTipWidth", () => {
  it("uses 16rem until 76vw is smaller", () => {
    assert.equal(estimateTipWidth(1200), 256);
    assert.equal(estimateTipWidth(300), 228);
  });
});
