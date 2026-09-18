import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import {
  cookieFlags,
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
  return { headers, socket: { remoteAddress: opts.peer } } as IncomingMessage;
}

describe("sessionCookie", () => {
  it("parses cookie header", () => {
    const got = parseCookies(`${SESSION_COOKIE}=abc%2Fdef; other=1`);
    assert.equal(got[SESSION_COOKIE], "abc/def");
    assert.equal(got.other, "1");
  });

  it("uses Lax cookies on loopback HTTP", () => {
    const flags = cookieFlags(fakeReq({ host: "127.0.0.1:8787" }));
    assert.equal(flags.sameSite, "Lax");
    assert.equal(flags.secure, false);
    const set = sessionSetCookie(fakeReq({ host: "127.0.0.1:8787" }), "tok");
    assert.match(set, /^xc_session=tok;/);
    assert.match(set, /HttpOnly/);
    assert.match(set, /SameSite=Lax/);
    assert.doesNotMatch(set, /Secure/);
  });

  it("uses None+Secure behind HTTPS / Cloudflare proto", () => {
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

  it("trusts X-Forwarded-Proto from a loopback proxy (tunnel)", () => {
    const flags = cookieFlags(
      fakeReq({ host: "api.xcopilot.dev", proto: "https", peer: "127.0.0.1" }),
    );
    assert.equal(flags.sameSite, "None");
    assert.equal(flags.secure, true);
  });

  it("ignores X-Forwarded-Proto from any other peer", () => {
    const flags = cookieFlags(
      fakeReq({ host: "api.xcopilot.dev", proto: "https", peer: "10.0.0.1" }),
    );
    assert.equal(flags.sameSite, "Lax");
    assert.equal(flags.secure, false);
  });

  it("serializes a clearing cookie", () => {
    const c = serializeCookie("xc_session", "", {
      clear: true,
      httpOnly: true,
      sameSite: "Lax",
    });
    assert.match(c, /Max-Age=0/);
  });
});
