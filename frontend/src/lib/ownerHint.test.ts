import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OWNER_HINT_COOKIE, isOwnerHint, readOwnerHint } from "./ownerHint.ts";

const HINT = "0123456789abcdef0123456789abcdef";

await describe("readOwnerHint", () => {
  it("reads the xc_owner cookie among others", () => {
    assert.equal(OWNER_HINT_COOKIE, "xc_owner");
    assert.equal(readOwnerHint(`a=1; xc_owner=${HINT}; b=2`), HINT);
    assert.equal(readOwnerHint(`xc_owner=${HINT}`), HINT);
  }).catch(assert.fail);

  it("returns null when the cookie is missing or empty", () => {
    assert.equal(readOwnerHint(""), null);
    assert.equal(readOwnerHint("a=1; b=2"), null);
    assert.equal(readOwnerHint("xc_owner="), null);
    assert.equal(readOwnerHint("xc_owner"), null);
  }).catch(assert.fail);

  it("rejects values that are not 32 lowercase hex characters", () => {
    assert.equal(readOwnerHint(`xc_owner=${HINT.toUpperCase()}`), null);
    assert.equal(readOwnerHint(`xc_owner=${HINT}0`), null);
    assert.equal(readOwnerHint(`xc_owner=${HINT.slice(1)}`), null);
    assert.equal(readOwnerHint(`xc_owner=${HINT.slice(1)}g`), null);
    assert.equal(readOwnerHint("xc_owner=%20"), null);
  }).catch(assert.fail);

  it("does not match cookies that merely contain the name", () => {
    assert.equal(readOwnerHint(`not_xc_owner=${HINT}`), null);
    assert.equal(readOwnerHint(`xc_owner2=${HINT}`), null);
  }).catch(assert.fail);

  it("returns null without a document", () => {
    assert.equal(readOwnerHint(), null);
  }).catch(assert.fail);

  it("validates hints", () => {
    assert.equal(isOwnerHint(HINT), true);
    assert.equal(isOwnerHint(null), false);
    assert.equal(isOwnerHint(42), false);
    assert.equal(isOwnerHint(""), false);
  }).catch(assert.fail);
});
