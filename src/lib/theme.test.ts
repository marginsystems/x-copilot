import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextTheme } from "./theme.ts";

describe("nextTheme", () => {
  it("flips dark to light and back", () => {
    assert.equal(nextTheme("dark"), "light");
    assert.equal(nextTheme("light"), "dark");
  });
});
