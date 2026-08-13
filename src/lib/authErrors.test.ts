import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authErrorMessage } from "./authErrors.ts";

describe("authErrorMessage", () => {
  it("maps known codes and falls back", () => {
    assert.equal(
      authErrorMessage("not_whitelisted"),
      "That account is not on the allowlist.",
    );
    assert.match(authErrorMessage("mystery") ?? "", /mystery/);
    assert.equal(authErrorMessage(null), null);
  });
});
