import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { testRequest } from "./http.testHelpers.ts";
import { corsHeaders, isLocalOrigin, isOriginAllowed, parseAllowedOrigins } from "./cors.ts";

function fakeReq(origin?: string): IncomingMessage {
  const req = testRequest();
  req.headers = origin ? { origin } : {};
  return req;
}

await describe("cors", async () => {
  await it("always includes local Vite origins", () => {
    const allowed = parseAllowedOrigins("");
    assert.ok(allowed.includes("http://127.0.0.1:5173"));
    assert.ok(allowed.includes("http://localhost:5173"));
  });

  await it("merges ALLOWED_ORIGINS", () => {
    const allowed = parseAllowedOrigins(
      "https://xcopilot.dev, https://www.xcopilot.dev",
    );
    assert.ok(allowed.includes("https://xcopilot.dev"));
    assert.ok(allowed.includes("https://www.xcopilot.dev"));
  });

  await it("skips local origins once ALLOWED_ORIGINS is set (prod)", () => {
    const allowed = parseAllowedOrigins("https://xcopilot.dev");
    assert.ok(allowed.includes("https://xcopilot.dev"));
    assert.ok(!allowed.includes("http://127.0.0.1:5173"));
    assert.ok(!allowed.includes("http://localhost:5173"));
  });

  await it("allows only local browser origins for memory endpoints", () => {
    assert.equal(isLocalOrigin("http://localhost:5173"), true);
    assert.equal(isLocalOrigin("http://127.0.0.1:8787"), true);
    assert.equal(isLocalOrigin("https://xcopilot.dev"), false);
    assert.equal(isLocalOrigin("not a url"), false);
    assert.equal(isLocalOrigin(undefined), true);
  });

  await it("allows missing Origin (non-browser clients)", () => {
    assert.equal(isOriginAllowed(undefined), true);
  });

  await it("reflects an allowed Origin and never uses *", () => {
    const headers = corsHeaders(
      fakeReq("http://127.0.0.1:5173"),
      parseAllowedOrigins(""),
    );
    assert.equal(headers["Access-Control-Allow-Origin"], "http://127.0.0.1:5173");
    assert.equal(headers["Access-Control-Allow-Credentials"], "true");
    assert.ok(
      (headers["Access-Control-Allow-Methods"] ?? "").includes("DELETE"),
    );
    assert.ok(
      (headers["Access-Control-Allow-Methods"] ?? "").includes("PUT"),
    );
    assert.ok(
      (headers["Access-Control-Allow-Methods"] ?? "").includes("PATCH"),
    );
    assert.notEqual(headers["Access-Control-Allow-Origin"], "*");
  });

  await it("omits Allow-Origin for unknown origins", () => {
    const headers = corsHeaders(
      fakeReq("https://evil.example"),
      parseAllowedOrigins("https://xcopilot.dev"),
    );
    assert.equal(headers["Access-Control-Allow-Origin"], undefined);
  });
});
