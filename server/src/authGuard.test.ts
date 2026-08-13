import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import {
  allowRate,
  authRequired,
  bindHost,
  clientIp,
  isPublicApiPath,
  resetRateLimiterForTests,
} from "./authGuard.ts";

describe("authGuard", () => {
  afterEach(() => {
    resetRateLimiterForTests();
  });

  it("defaults bind to loopback", () => {
    assert.equal(bindHost({}), "127.0.0.1");
    assert.equal(bindHost({ BIND_HOST: "0.0.0.0" }), "0.0.0.0");
  });

  it("requires auth when whitelist or public bind is set", () => {
    assert.equal(authRequired({}), false);
    assert.equal(
      authRequired({ AUTH_EMAIL_WHITELIST: "margin707@gmail.com" }),
      true,
    );
    assert.equal(authRequired({ BIND_HOST: "0.0.0.0" }), true);
    assert.equal(
      authRequired({ BIND_HOST: "0.0.0.0", AUTH_REQUIRED: "0" }),
      false,
    );
    assert.equal(authRequired({ AUTH_REQUIRED: "1" }), true);
  });

  it("treats health and auth as public", () => {
    assert.equal(isPublicApiPath("/api/health"), true);
    assert.equal(isPublicApiPath("/health"), true);
    assert.equal(isPublicApiPath("/api/auth/google"), true);
    assert.equal(isPublicApiPath("/api/auth/me"), true);
    assert.equal(isPublicApiPath("/api/scout/run"), false);
    assert.equal(isPublicApiPath("/api/usage"), false);
  });

  it("prefers CF-Connecting-IP", () => {
    const req = {
      headers: {
        "cf-connecting-ip": "1.2.3.4",
        "x-forwarded-for": "9.9.9.9, 8.8.8.8",
      },
      socket: { remoteAddress: "10.0.0.1" },
    } as unknown as IncomingMessage;
    assert.equal(clientIp(req), "1.2.3.4");
  });

  it("rate-limits a key", () => {
    assert.equal(allowRate("k", 2, 1000, 0), true);
    assert.equal(allowRate("k", 2, 1000, 1), true);
    assert.equal(allowRate("k", 2, 1000, 2), false);
    assert.equal(allowRate("k", 2, 1000, 1001), true);
  });
});
