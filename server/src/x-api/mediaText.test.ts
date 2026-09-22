import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTcoKey,
  stripMediaShortlinksFromText,
} from "./mediaText.ts";

await describe("normalizeTcoKey", async () => {
  await it("normalizes https and bare t.co forms", () => {
    assert.equal(normalizeTcoKey("https://t.co/f2WC3JoDhC"), "t.co/f2wc3jodhc");
    assert.equal(normalizeTcoKey("t.co/AbC123"), "t.co/abc123");
    assert.equal(normalizeTcoKey("https://example.com/x"), null);
  });
});

await describe("stripMediaShortlinksFromText", async () => {
  await it("strips known media shortlinks and leaves outbound URLs", () => {
    const text =
      "KYA question https://t.co/f2WC3JoDhC see also https://example.com/doc";
    const out = stripMediaShortlinksFromText(text, ["t.co/f2wc3jodhc"]);
    assert.equal(out, "KYA question see also https://example.com/doc");
  });

  await it("is a no-op without mediaShortlinks", () => {
    const text = "Photo https://t.co/abc123";
    assert.equal(stripMediaShortlinksFromText(text, undefined), text);
    assert.equal(stripMediaShortlinksFromText(text, []), text);
  });

  await it("leaves unknown t.co codes alone", () => {
    const text = "Maybe media https://t.co/unknown1";
    assert.equal(
      stripMediaShortlinksFromText(text, ["t.co/other"]),
      text,
    );
  });
});
