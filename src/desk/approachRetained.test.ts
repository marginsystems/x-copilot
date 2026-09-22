import assert from "node:assert/strict";
import { it } from "node:test";
import { parseRetainedScout } from "./approachRetained";

await it("retains valid Scout card fields and rejects malformed saved cards", () => {
  const card = { id: "1", author: "@a", text: "post", url: "https://x.com/a/status/1", views: 42, surface: "reply" };
  assert.deepEqual(parseRetainedScout(JSON.stringify(card)), card);
  assert.equal(parseRetainedScout(JSON.stringify({ ...card, views: "42" })), null);
  assert.equal(parseRetainedScout(JSON.stringify({ ...card, id: null })), null);
  assert.equal(parseRetainedScout("invalid"), null);
  assert.equal(parseRetainedScout(null), null);
});
