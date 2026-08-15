import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLegalKind, LEGAL_CONTACT_EMAIL, LEGAL_ENTITY } from "./legal.ts";

describe("legal", () => {
  it("names Mergestorm and the shared contact inbox", () => {
    assert.equal(LEGAL_ENTITY, "Mergestorm, Inc.");
    assert.equal(LEGAL_CONTACT_EMAIL, "contact@mergestorm.ai");
  });

  it("narrows privacy and terms paths", () => {
    assert.equal(isLegalKind("privacy"), true);
    assert.equal(isLegalKind("terms"), true);
    assert.equal(isLegalKind("usage"), false);
  });
});
