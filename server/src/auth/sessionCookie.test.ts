import { testRequest } from "../http/http.testHelpers.js";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import {
  cookieFlags,
  ownerHintClearCookie,
  ownerHintForSession,
  ownerHintSetCookie,
  parseCookies,
  serializeCookie,
  SESSION_COOKIE,
  sessionSetCookie,
} from "./sessionCookie.ts";

function fakeReq(opts: {
  host?: string;
  proto?: string;
  cookie?: string;
  peer?: string;
}): IncomingMessage {
  const headers: Record<string, string> = {};
  if (opts.host) headers.host = opts.host;
  if (opts.proto) headers["x-forwarded-proto"] = opts.proto;
  if (opts.cookie) headers.cookie = opts.cookie;
  const req = Object.assign(testRequest(), {
    headers
  });
  Object.defineProperty(req.socket, "remoteAddress", { value: opts.peer });
  return req;
}

await describe("sessionCookie", async () => {
  await it("parses cookie header", () => {
    const got = parseCookies(`${SESSION_COOKIE}=abc%2Fdef; other=1`);
    assert.equal(got[SESSION_COOKIE], "abc/def");
    assert.equal(got.other, "1");
  });

  await it("uses Lax cookies on loopback HTTP", () => {
    const flags = cookieFlags(fakeReq({ host: "127.0.0.1:8787" }));
    assert.equal(flags.sameSite, "Lax");
    assert.equal(flags.secure, false);
    const set = sessionSetCookie(fakeReq({ host: "127.0.0.1:8787" }), "tok");
    assert.match(set, /^xc_session=tok;/);
    assert.match(set, /HttpOnly/);
    assert.match(set, /SameSite=Lax/);
    assert.doesNotMatch(set, /Secure/);
  });

  await it("uses None+Secure behind HTTPS / Cloudflare proto", () => {
    const flags = cookieFlags(
      fakeReq({
        host: "api.xcopilot.dev",
        proto: "https",
        peer: "173.245.48.1",
      }),
    );
    assert.equal(flags.sameSite, "None");
    assert.equal(flags.secure, true);
    const set = sessionSetCookie(
      fakeReq({
        host: "api.xcopilot.dev",
        proto: "https",
        peer: "173.245.48.1",
      }),
      "tok",
    );
    assert.match(set, /SameSite=None/);
    assert.match(set, /Secure/);
  });

  await it("trusts X-Forwarded-Proto from a loopback proxy (tunnel)", () => {
    const flags = cookieFlags(
      fakeReq({ host: "api.xcopilot.dev", proto: "https", peer: "127.0.0.1" }),
    );
    assert.equal(flags.sameSite, "None");
    assert.equal(flags.secure, true);
  });

  await it("ignores X-Forwarded-Proto from any other peer", () => {
    const flags = cookieFlags(
      fakeReq({ host: "api.xcopilot.dev", proto: "https", peer: "10.0.0.1" }),
    );
    assert.equal(flags.sameSite, "Lax");
    assert.equal(flags.secure, false);
  });

  await it("serializes a clearing cookie", () => {
    const c = serializeCookie("xc_session", "", {
      clear: true,
      httpOnly: true,
      sameSite: "Lax",
    });
    assert.match(c, /Max-Age=0/);
  });

  await describe("owner hint cookie", async () => {
    const prevFrontend = process.env.FRONTEND_ORIGIN;
    beforeEach(() => {
      process.env.FRONTEND_ORIGIN = "https://xcopilot.dev";
    });
    afterEach(() => {
      if (prevFrontend === undefined) delete process.env.FRONTEND_ORIGIN;
      else process.env.FRONTEND_ORIGIN = prevFrontend;
    });

    const prodReq = () =>
      fakeReq({ host: "api.xcopilot.dev", proto: "https", peer: "173.245.48.1" });

    await it("derives a stable 32 hex hint per session", () => {
      const a = ownerHintForSession("session-a");
      assert.match(a, /^[0-9a-f]{32}$/);
      assert.equal(a, ownerHintForSession("session-a"));
      assert.notEqual(a, ownerHintForSession("session-b"));
    });

    await it("sets a readable Lax cookie on the frontend domain", () => {
      const set = ownerHintSetCookie(prodReq(), "session-a", 1234);
      assert.ok(set);
      assert.ok(set.startsWith(`xc_owner=${ownerHintForSession("session-a")};`));
      assert.match(set, /Domain=xcopilot\.dev/);
      assert.match(set, /Path=\//);
      assert.match(set, /Max-Age=1234/);
      assert.match(set, /SameSite=Lax/);
      assert.match(set, /Secure/);
      assert.doesNotMatch(set, /HttpOnly/);
    });

    await it("is host-only on loopback and not Secure over http", () => {
      const set = ownerHintSetCookie(fakeReq({ host: "127.0.0.1:8787" }), "s", 60);
      assert.ok(set);
      assert.doesNotMatch(set, /Domain=/);
      assert.doesNotMatch(set, /Secure/);
      assert.doesNotMatch(set, /HttpOnly/);
      assert.match(set, /SameSite=Lax/);
      const local = ownerHintSetCookie(fakeReq({ host: "localhost:8787" }), "s", 60);
      assert.ok(local);
      assert.doesNotMatch(local, /Domain=/);
    });

    await it("accepts the bare frontend host as well as subdomains", () => {
      const set = ownerHintSetCookie(fakeReq({ host: "xcopilot.dev", proto: "https", peer: "173.245.48.1" }), "s", 60);
      assert.ok(set);
      assert.match(set, /Domain=xcopilot\.dev/);
    });

    await it("is off for a foreign host", () => {
      const foreign = fakeReq({ host: "api.example.com", proto: "https", peer: "173.245.48.1" });
      assert.equal(ownerHintSetCookie(foreign, "s", 60), null);
      assert.equal(ownerHintClearCookie(foreign), null);
      const lookalike = fakeReq({ host: "evilxcopilot.dev", proto: "https", peer: "173.245.48.1" });
      assert.equal(ownerHintSetCookie(lookalike, "s", 60), null);
    });

    await it("clears with the same domain and Max-Age=0", () => {
      const clear = ownerHintClearCookie(prodReq());
      assert.ok(clear);
      assert.match(clear, /^xc_owner=;/);
      assert.match(clear, /Max-Age=0/);
      assert.match(clear, /Domain=xcopilot\.dev/);
      assert.doesNotMatch(clear, /HttpOnly/);
    });
  });
});
