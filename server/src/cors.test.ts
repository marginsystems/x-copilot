import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { corsHeaders, isOriginAllowed, parseAllowedOrigins } from "./cors.ts";

function fakeReq(origin?: string): IncomingMessage {
  return { headers: origin ? { origin } : {} } as IncomingMessage;
}

describe("cors", () => {
  it("always includes local Vite origins", () => {
    const allowed = parseAllowedOrigins("");
    assert.ok(allowed.includes("http://127.0.0.1:5173"));
    assert.ok(allowed.includes("http://localhost:5173"));
  });

  it("merges ALLOWED_ORIGINS", () => {
    const allowed = parseAllowedOrigins(
      "https://xcopilot.dev, https://www.xcopilot.dev",
    );
    assert.ok(allowed.includes("https://xcopilot.dev"));
    assert.ok(allowed.includes("https://www.xcopilot.dev"));
  });

  it("allows missing Origin (non-browser clients)", () => {
    assert.equal(isOriginAllowed(undefined), true);
  });

  it("reflects an allowed Origin and never uses *", () => {
    const headers = corsHeaders(
      fakeReq("http://127.0.0.1:5173"),
      parseAllowedOrigins(""),
    );
    assert.equal(headers["Access-Control-Allow-Origin"], "http://127.0.0.1:5173");
    assert.equal(headers["Access-Control-Allow-Credentials"], "true");
    assert.notEqual(headers["Access-Control-Allow-Origin"], "*");
  });

  it("omits Allow-Origin for unknown origins", () => {
    const headers = corsHeaders(
      fakeReq("https://evil.example"),
      parseAllowedOrigins("https://xcopilot.dev"),
    );
    assert.equal(headers["Access-Control-Allow-Origin"], undefined);
  });
});
