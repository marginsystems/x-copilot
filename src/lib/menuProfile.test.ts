import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { menuAvatarUrl, menuInitials } from "./menuProfile.ts";

describe("menuInitials", () => {
  it("uses first letters of a two-word name", () => {
    assert.equal(menuInitials("Mark Argin", "m@x.com", "marginsystems"), "MA");
  }).catch(assert.fail);

  it("falls back to handle then email local-part", () => {
    assert.equal(menuInitials(null, null, "alice_dev"), "AD");
    assert.equal(menuInitials(null, "scout@xcopilot.dev", null), "SC");
  }).catch(assert.fail);

  it("uses two letters of a single token", () => {
    assert.equal(menuInitials("Scout", null, null), "SC");
  }).catch(assert.fail);
}).catch(assert.fail);

describe("menuAvatarUrl", () => {
  it("accepts https photos only", () => {
    assert.equal(
      menuAvatarUrl("https://lh3.googleusercontent.com/a/photo"),
      "https://lh3.googleusercontent.com/a/photo",
    );
    assert.equal(menuAvatarUrl("javascript:alert(1)"), null);
    assert.equal(menuAvatarUrl("  "), null);
  }).catch(assert.fail);
}).catch(assert.fail);
