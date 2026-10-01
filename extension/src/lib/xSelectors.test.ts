import { describe, expect, it } from "vitest";
import { parseAttentionGate } from "./settings";
import { chipPosition, rectInViewport } from "./xSelectors";

const rect = (top: number, height: number, left = 10, width = 300) => ({
  top,
  bottom: top + height,
  left,
  right: left + width,
  width,
  height,
});

describe("rectInViewport", () => {
  const viewport = { width: 1000, height: 800 };

  it("needs a visible box that overlaps the viewport", () => {
    expect(rectInViewport(rect(100, 200), viewport)).toBe(true);
    expect(rectInViewport(rect(-150, 200), viewport)).toBe(true);
    expect(rectInViewport(rect(-300, 200), viewport)).toBe(false);
    expect(rectInViewport(rect(900, 200), viewport)).toBe(false);
    expect(rectInViewport(rect(100, 0), viewport)).toBe(false);
  });
});

describe("chipPosition", () => {
  it("sits above the composer, or below it near the top edge", () => {
    expect(chipPosition(rect(300, 60), 24)).toEqual({ top: 270, left: 10 });
    expect(chipPosition(rect(10, 60), 24)).toEqual({ top: 76, left: 10 });
  });
});

describe("parseAttentionGate", () => {
  it("is on unless turned off", () => {
    expect(parseAttentionGate(undefined)).toBe(true);
    expect(parseAttentionGate(true)).toBe(true);
    expect(parseAttentionGate(false)).toBe(false);
  });
});
