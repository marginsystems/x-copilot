import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { liveRatio, seedLife, stepLife } from "./pixelField.ts";

function gridFrom(rows: string[]): { grid: Uint8Array; cols: number; rows: number } {
  const cols = rows[0].length;
  const grid = new Uint8Array(cols * rows.length);
  rows.forEach((line, r) => {
    for (let c = 0; c < line.length; c++) {
      if (line[c] === "#") grid[r * cols + c] = 1;
    }
  });
  return { grid, cols, rows: rows.length };
}

describe("stepLife", () => {
  it("oscillates a blinker", () => {
    const { grid, cols, rows } = gridFrom([".....", "..#..", "..#..", "..#..", "....."]);
    const once = stepLife(grid, cols, rows);
    const horizontal = gridFrom([".....", ".....", ".###.", ".....", "....."]).grid;
    assert.deepEqual(Array.from(once), Array.from(horizontal));
    const twice = stepLife(once, cols, rows);
    assert.deepEqual(Array.from(twice), Array.from(grid));
  });

  it("keeps a block still", () => {
    const { grid, cols, rows } = gridFrom(["....", ".##.", ".##.", "...."]);
    const next = stepLife(grid, cols, rows);
    assert.deepEqual(Array.from(next), Array.from(grid));
  });

  it("kills a lone cell", () => {
    const { grid, cols, rows } = gridFrom(["...", ".#.", "..."]);
    const next = stepLife(grid, cols, rows);
    assert.equal(liveRatio(next), 0);
  });
});

describe("seedLife", () => {
  it("fills roughly the requested ratio with a deterministic rng", () => {
    const grid = new Uint8Array(10);
    let calls = 0;
    seedLife(grid, 0.5, () => (calls++ % 2 === 0 ? 0.1 : 0.9));
    assert.equal(liveRatio(grid), 0.5);
  });

  it("never clears already-live cells", () => {
    const grid = new Uint8Array([1, 1, 0, 0]);
    seedLife(grid, 0, () => 1);
    assert.deepEqual(Array.from(grid), [1, 1, 0, 0]);
  });
});
