/**
 * Pure Conway-style life logic for the Agenda pixel flight field.
 * Kept free of DOM so it can run under node:test.
 */

export function stepLife(
  grid: Uint8Array,
  cols: number,
  rows: number,
  out?: Uint8Array,
): Uint8Array {
  const next = out ?? new Uint8Array(grid.length);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const c = col + dx;
          const r = row + dy;
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          if (grid[r * cols + c]) neighbors++;
        }
      }
      const i = row * cols + col;
      if (grid[i]) {
        next[i] = neighbors === 2 || neighbors === 3 ? 1 : 0;
      } else {
        next[i] = neighbors === 3 ? 1 : 0;
      }
    }
  }
  return next;
}

export function seedLife(
  grid: Uint8Array,
  ratio: number,
  rng: () => number = Math.random,
): void {
  for (let i = 0; i < grid.length; i++) {
    if (rng() < ratio) grid[i] = 1;
  }
}

export function liveRatio(grid: Uint8Array): number {
  if (grid.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i]) n++;
  return n / grid.length;
}

/** Right-pointing paper-plane silhouette, one grid cell per `#`. */
export const PLANE_MASK: readonly string[] = [
  "#.....",
  "####..",
  "######",
  "####..",
  "#.....",
];
