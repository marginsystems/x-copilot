import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripMediaShortlinksFromText } from "./mediaText.ts";

describe("stripMediaShortlinksFromText (client)", () => {
  it("hides known media shortlinks in card text", () => {
    const text =
      "What's your read on KYA https://t.co/f2WC3JoDhC";
    assert.equal(
      stripMediaShortlinksFromText(text, ["t.co/f2wc3jodhc"]),
      "What's your read on KYA",
    );
  });
});
