import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "99-motion.css"), "utf8");

await describe("reduced motion", () => {
  it("disables the dial needle and fill transitions", () => {
    assert.match(css, /\.dial-needle,\s*\.dial-fill\s*\{\s*transition:\s*none;/);
  }).catch(assert.fail);
});
