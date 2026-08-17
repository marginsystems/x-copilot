import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseUserAgent, toPublicSession, type SessionListRow } from "./sessionView.ts";

describe("parseUserAgent", () => {
  it("reads Chrome on macOS", () => {
    assert.deepEqual(
      parseUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      ),
      { browser: "Chrome", os: "macOS" },
    );
  });

  it("reads Firefox on Windows", () => {
    assert.deepEqual(
      parseUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
      ),
      { browser: "Firefox", os: "Windows" },
    );
  });

  it("reads Safari on iOS without calling it Chrome", () => {
    assert.deepEqual(
      parseUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
      { browser: "Safari", os: "iOS" },
    );
  });

  it("reads Edge before Chrome", () => {
    assert.deepEqual(
      parseUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
      ),
      { browser: "Edge", os: "Windows" },
    );
  });

  it("falls back when empty", () => {
    assert.deepEqual(parseUserAgent(null), { browser: "Unknown", os: "Unknown" });
    assert.deepEqual(parseUserAgent(""), { browser: "Unknown", os: "Unknown" });
  });
});

describe("toPublicSession", () => {
  const row: SessionListRow = {
    id: "sess-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    lastSeenAt: "2026-08-17T00:00:00.000Z",
    createdIp: "1.1.1.1",
    lastSeenIp: "8.8.8.8",
    createdUserAgent: "Firefox/1.0",
    lastSeenUserAgent:
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36",
  };

  it("marks the current device and prefers last-seen IP/UA", () => {
    const pub = toPublicSession(row, "sess-1");
    assert.equal(pub.current, true);
    assert.equal(pub.ip, "8.8.8.8");
    assert.equal(pub.browser, "Chrome");
    assert.equal(pub.os, "Android");
    assert.equal("tokenHash" in pub, false);
    assert.equal("token_hash" in pub, false);
    assert.equal(JSON.stringify(pub).includes("token"), false);
  });

  it("does not mark another session as current", () => {
    assert.equal(toPublicSession(row, "other").current, false);
  });
});
