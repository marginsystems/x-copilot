import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  frontendOrigin,
  googleClientConfig,
  isEmailWhitelisted,
  isXHandleWhitelisted,
  parseEmailWhitelist,
} from "./authConfig.ts";

describe("authConfig whitelist", () => {
  it("normalizes emails and fails closed when empty", () => {
    assert.deepEqual(parseEmailWhitelist("  margin707@gmail.com "), [
      "margin707@gmail.com",
    ]);
    assert.equal(isEmailWhitelisted("alice@example.com", []), false);
    assert.equal(
      isEmailWhitelisted("margin707@gmail.com", ["margin707@gmail.com"]),
      true,
    );
    assert.equal(
      isEmailWhitelisted("MARGIN707@gmail.com", ["margin707@gmail.com"]),
      true,
    );
    assert.equal(
      isEmailWhitelisted("other@gmail.com", ["margin707@gmail.com"]),
      false,
    );
    assert.equal(isEmailWhitelisted(null, ["margin707@gmail.com"]), false);
  });

  it("strips @ from X handles", () => {
    assert.equal(isXHandleWhitelisted("alice", ["alice"]), true);
    assert.equal(isXHandleWhitelisted("@Alice", ["alice"]), true);
    assert.equal(isXHandleWhitelisted("bob", ["alice"]), false);
    assert.equal(isXHandleWhitelisted("alice", []), false);
  });

  it("picks FRONTEND_ORIGIN then first https allowed origin", () => {
    assert.equal(
      frontendOrigin({ FRONTEND_ORIGIN: "https://xcopilot.dev/" }),
      "https://xcopilot.dev",
    );
    assert.equal(
      frontendOrigin({
        ALLOWED_ORIGINS: "http://127.0.0.1:5173,https://xcopilot.dev",
      }),
      "https://xcopilot.dev",
    );
    assert.equal(frontendOrigin({}), "http://127.0.0.1:5173");
  });

  it("defaults the Google redirect URI to the API host (loopback, like X)", () => {
    const local = googleClientConfig({
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "sec",
    });
    assert.equal(local?.redirectUri, "http://127.0.0.1:8787/api/auth/google/callback");
    const ported = googleClientConfig({
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "sec",
      PORT: "9999",
    });
    assert.equal(ported?.redirectUri, "http://127.0.0.1:9999/api/auth/google/callback");
    const prod = googleClientConfig({
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "sec",
      GOOGLE_REDIRECT_URI: "https://api.xcopilot.dev/api/auth/google/callback",
    });
    assert.equal(prod?.redirectUri, "https://api.xcopilot.dev/api/auth/google/callback");
    assert.equal(
      googleClientConfig({ GOOGLE_CLIENT_ID: "cid" }),
      null,
    );
  });
});
