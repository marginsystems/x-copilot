import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXTENSION_HELLO,
  EXTENSION_PAIR,
  EXTENSION_PAIRED,
  EXTENSION_PING,
  parseExtensionHello,
  parseExtensionPair,
  parseExtensionPaired,
  parseExtensionPing,
  parseExtensionSessionGrant,
} from "./extensionBridge.ts";

const EXPIRES = "2026-11-01T00:00:00.000Z";

await describe("extension bridge messages", () => {
  it("accepts well-formed messages and drops extra fields", () => {
    assert.deepEqual(parseExtensionPing({ type: EXTENSION_PING, extra: 1 }), { type: EXTENSION_PING });
    assert.deepEqual(
      parseExtensionHello({ type: EXTENSION_HELLO, version: "0.1.0", paired: false, extra: 1 }),
      { type: EXTENSION_HELLO, version: "0.1.0", paired: false },
    );
    assert.deepEqual(
      parseExtensionPair({ type: EXTENSION_PAIR, token: "t", expiresAt: EXPIRES, apiBase: "https://api.xcopilot.dev" }),
      { type: EXTENSION_PAIR, token: "t", expiresAt: EXPIRES, apiBase: "https://api.xcopilot.dev" },
    );
    assert.deepEqual(parseExtensionPaired({ type: EXTENSION_PAIRED, ok: true }), { type: EXTENSION_PAIRED, ok: true });
  }).catch(assert.fail);

  it("rejects other message types and malformed fields", () => {
    for (const bad of [null, "x", [], {}, { type: "other" }]) {
      assert.equal(parseExtensionPing(bad), null);
      assert.equal(parseExtensionHello(bad), null);
      assert.equal(parseExtensionPair(bad), null);
      assert.equal(parseExtensionPaired(bad), null);
    }
    assert.equal(parseExtensionHello({ type: EXTENSION_HELLO, version: 1, paired: false }), null);
    assert.equal(parseExtensionPair({ type: EXTENSION_PAIR, token: "", expiresAt: EXPIRES, apiBase: "https://api.xcopilot.dev" }), null);
    assert.equal(parseExtensionPair({ type: EXTENSION_PAIR, token: "t", expiresAt: "soon", apiBase: "https://api.xcopilot.dev" }), null);
    assert.equal(parseExtensionPair({ type: EXTENSION_PAIR, token: "t", expiresAt: EXPIRES, apiBase: "https://api.xcopilot.dev/api" }), null);
    assert.equal(parseExtensionPair({ type: EXTENSION_PAIR, token: "t", expiresAt: EXPIRES, apiBase: "javascript:alert(1)" }), null);
    assert.equal(parseExtensionPaired({ type: EXTENSION_PAIRED, ok: "yes" }), null);
  }).catch(assert.fail);

  it("reads the server's pairing grant", () => {
    assert.deepEqual(parseExtensionSessionGrant({ ok: true, token: "t", expiresAt: EXPIRES }), { token: "t", expiresAt: EXPIRES });
    assert.equal(parseExtensionSessionGrant({ ok: false, token: "t", expiresAt: EXPIRES }), null);
    assert.equal(parseExtensionSessionGrant({ ok: true, token: "", expiresAt: EXPIRES }), null);
  }).catch(assert.fail);
});
