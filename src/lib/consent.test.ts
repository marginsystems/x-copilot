import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseConsent } from "./consent.ts";

describe("parseConsent", () => {
  it("accepts only explicit choices", () => {
    assert.equal(parseConsent("accepted"), "accepted");
    assert.equal(parseConsent("rejected"), "rejected");
    assert.equal(parseConsent(null), null);
    assert.equal(parseConsent("granted"), null);
  });
});
