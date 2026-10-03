import { describe, expect, it } from "vitest";
import { parseAttentionGate } from "./settings";
import { chipPagePosition, rectInViewport } from "./xSelectors";

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

describe("chipPagePosition", () => {
  it("anchors to the composer's top-right corner in page coordinates", () => {
    expect(chipPagePosition(rect(300, 60), { x: 0, y: 0 }, 22)).toEqual({ top: 272, right: 310 });
  });

  it("stays on the same page spot while the page scrolls", () => {
    const before = chipPagePosition(rect(300, 60), { x: 0, y: 1000 }, 22);
    const after = chipPagePosition(rect(-200, 60), { x: 0, y: 1500 }, 22);
    expect(after).toEqual(before);
  });

  it("drops below a composer at the very top of the page", () => {
    expect(chipPagePosition(rect(10, 60), { x: 0, y: 0 }, 22)).toEqual({ top: 76, right: 310 });
  });
});

describe("parseAttentionGate", () => {
  it("is on unless turned off", () => {
    expect(parseAttentionGate(undefined)).toBe(true);
    expect(parseAttentionGate(true)).toBe(true);
    expect(parseAttentionGate(false)).toBe(false);
  });
});
