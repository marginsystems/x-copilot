import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { isAdminEmail, parseAdminEmails } from "./adminEmails.ts";

describe("adminEmails", () => {
  const prev = process.env.ADMIN_EMAILS;

  afterEach(() => {
    if (prev === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = prev;
  });

  it("parses comma-separated ADMIN_EMAILS", () => {
    assert.deepEqual(parseAdminEmails(" margin707@gmail.com, ops@example.com "), [
      "margin707@gmail.com",
      "ops@example.com",
    ]);
  });

  it("fails closed when unset", () => {
    delete process.env.ADMIN_EMAILS;
    assert.equal(isAdminEmail("margin707@gmail.com"), false);
  });

  it("matches the operator allowlist", () => {
    process.env.ADMIN_EMAILS = "margin707@gmail.com";
    assert.equal(isAdminEmail("margin707@gmail.com"), true);
    assert.equal(isAdminEmail("MARGIN707@gmail.com"), true);
    assert.equal(isAdminEmail("other@gmail.com"), false);
  });
});
