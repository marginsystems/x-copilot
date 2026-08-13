import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_API_ORIGIN,
  PROD_API_ORIGIN,
  apiBase,
  apiUrl,
  isLocalHostname,
} from "./apiBase.ts";

describe("apiBase", () => {
  it("uses loopback API on localhost / 127.0.0.1", () => {
    assert.equal(isLocalHostname("localhost"), true);
    assert.equal(isLocalHostname("127.0.0.1"), true);
    assert.equal(isLocalHostname("xcopilot.dev"), false);
    assert.equal(apiBase("localhost"), LOCAL_API_ORIGIN);
    assert.equal(apiBase("127.0.0.1"), LOCAL_API_ORIGIN);
    assert.equal(apiBase("xcopilot.dev"), PROD_API_ORIGIN);
    assert.equal(apiBase("www.xcopilot.dev"), PROD_API_ORIGIN);
  });

  it("prefixes paths onto the API origin", () => {
    assert.equal(
      apiUrl("/api/auth/me", "xcopilot.dev"),
      `${PROD_API_ORIGIN}/api/auth/me`,
    );
    assert.equal(
      apiUrl("api/health", "127.0.0.1"),
      `${LOCAL_API_ORIGIN}/api/health`,
    );
  });
});
