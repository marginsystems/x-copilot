import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "99-motion.css"), "utf8");

describe("reduced motion", () => {
  it("disables cockpit dial transitions and circle skeleton animations", () => {
    assert.match(css, /\.dial-needle,\s*\.dial-fill\s*\{\s*transition:\s*none;/);
    assert.match(
      css,
      /\.desk-circle-thumb\.is-skeleton,\s*\.desk-circle-skeleton-row::before\s*\{\s*animation:\s*none;/,
    );
  });
});
