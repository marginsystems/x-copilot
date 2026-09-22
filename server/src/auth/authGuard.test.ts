import { testRequest } from "../http/http.testHelpers.js";
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  allowRate,
  authRequired,
  bindHost,
  clientIp,
  isPublicApiPath,
  resetRateLimiterForTests,
} from "./authGuard.ts";

await describe("authGuard", async () => {
  afterEach(() => {
    resetRateLimiterForTests();
  });

  await it("defaults bind to loopback", () => {
    assert.equal(bindHost({}), "127.0.0.1");
    assert.equal(bindHost({ BIND_HOST: "0.0.0.0" }), "0.0.0.0");
  });

  await it("requires a session by default and on a public bind", () => {
    assert.equal(authRequired({}), true);
    assert.equal(authRequired({ BIND_HOST: "0.0.0.0" }), true);
    assert.equal(authRequired({ AUTH_REQUIRED: "1" }), true);
    assert.equal(authRequired({ BIND_HOST: "127.0.0.1", AUTH_REQUIRED: "0" }), false);
  });

  await it("never disables the gate on a public bind", () => {
    assert.equal(
      authRequired({ BIND_HOST: "0.0.0.0", AUTH_REQUIRED: "0" }),
      true,
    );
    assert.equal(
      authRequired({ BIND_HOST: "0.0.0.0", AUTH_REQUIRED: "false" }),
      true,
    );
    assert.equal(
      authRequired({ BIND_HOST: "::", AUTH_REQUIRED: "0" }),
      true,
    );
    assert.equal(authRequired({ BIND_HOST: "127.0.0.1", AUTH_REQUIRED: "0" }), false);
  });

  await it("treats health and auth as public", () => {
    assert.equal(isPublicApiPath("/api/health"), true);
    assert.equal(isPublicApiPath("/health"), true);
    assert.equal(isPublicApiPath("/api/auth/google"), true);
    assert.equal(isPublicApiPath("/api/auth/me"), true);
    assert.equal(isPublicApiPath("/api/auth/sessions"), true);
    assert.equal(isPublicApiPath("/api/auth/account"), true);
    assert.equal(isPublicApiPath("/api/stripe/webhook"), true);
    assert.equal(isPublicApiPath("/api/x/activity"), true);
    assert.equal(isPublicApiPath("/api/onboarding/generate"), true);
    assert.equal(isPublicApiPath("/api/mail/unsubscribe"), true);
    assert.equal(isPublicApiPath("/api/boot"), true);
    assert.equal(isPublicApiPath("/api/mail/preferences"), false);
    assert.equal(isPublicApiPath("/api/scout/run"), false);
    assert.equal(isPublicApiPath("/api/usage"), false);
    assert.equal(isPublicApiPath("/api/analytics"), false);
    assert.equal(isPublicApiPath("/api/watch"), false);
  });

  await it("trusts CF-Connecting-IP only from a Cloudflare peer", () => {
    const req = Object.assign(testRequest(), {
      headers: {
        "cf-connecting-ip": "1.2.3.4",
        "x-forwarded-for": "9.9.9.9, 8.8.8.8",
      }
    });
    Object.defineProperty(req.socket, "remoteAddress", { value: "173.245.48.1" });
    assert.equal(clientIp(req), "1.2.3.4");
  });

  await it("ignores forwarded headers from a non-Cloudflare peer", () => {
    const req = Object.assign(testRequest(), {
      headers: {
        "cf-connecting-ip": "1.2.3.4",
        "x-forwarded-for": "9.9.9.9, 8.8.8.8",
      }
    });
    Object.defineProperty(req.socket, "remoteAddress", { value: "10.0.0.1" });
    assert.equal(clientIp(req), "10.0.0.1");
  });

  await it("ignores spoofable forwarded headers from a loopback peer", () => {
    const req = Object.assign(testRequest(), {
      headers: {
        "cf-connecting-ip": "1.2.3.4",
        "x-forwarded-for": "9.9.9.9, 8.8.8.8",
      }
    });
    Object.defineProperty(req.socket, "remoteAddress", { value: "::1" });
    assert.equal(clientIp(req), "::1");
  });

  await it("trusts X-Real-IP from a loopback terminator", () => {
    const req = Object.assign(testRequest(), {
      headers: {
        "x-real-ip": "203.0.113.10",
        "x-forwarded-for": "9.9.9.9, 8.8.8.8",
        "cf-connecting-ip": "1.2.3.4",
      }
    });
    Object.defineProperty(req.socket, "remoteAddress", { value: "127.0.0.1" });
    assert.equal(clientIp(req), "203.0.113.10");
  });

  await it("rejects a list or junk X-Real-IP from loopback", () => {
    const list = Object.assign(testRequest(), {
      headers: { "x-real-ip": "203.0.113.10, 198.51.100.1" }
    });
    Object.defineProperty(list.socket, "remoteAddress", { value: "127.0.0.1" });
    assert.equal(clientIp(list), "127.0.0.1");
    const junk = Object.assign(testRequest(), {
      headers: { "x-real-ip": "not-an-ip" }
    });
    Object.defineProperty(junk.socket, "remoteAddress", { value: "::ffff:127.0.0.1" });
    assert.equal(clientIp(junk), "::ffff:127.0.0.1");
  });

  await it("does not trust X-Real-IP from a non-loopback peer", () => {
    const req = Object.assign(testRequest(), {
      headers: { "x-real-ip": "203.0.113.10" }
    });
    Object.defineProperty(req.socket, "remoteAddress", { value: "10.0.0.1" });
    assert.equal(clientIp(req), "10.0.0.1");
  });

  await it("falls back to the socket address without forwarded headers", () => {
    const req = Object.assign(testRequest(), {
      headers: {}
    });
    Object.defineProperty(req.socket, "remoteAddress", { value: "::1" });
    assert.equal(clientIp(req), "::1");
  });

  await it("rate-limits a key", () => {
    assert.equal(allowRate("k", 2, 1000, 0), true);
    assert.equal(allowRate("k", 2, 1000, 1), true);
    assert.equal(allowRate("k", 2, 1000, 2), false);
    assert.equal(allowRate("k", 2, 1000, 1001), true);
  });

  await it("evicts keys whose window has fully expired", () => {
    assert.equal(allowRate("old", 1, 1000, 0), true);
    assert.equal(allowRate("old", 1, 1000, 5), false);
    assert.equal(allowRate("other", 1, 1000, 1001), true);
    assert.equal(allowRate("old", 1, 1000, 1001), true);
  });
});
