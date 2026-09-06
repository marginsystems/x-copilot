import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readBootQuery } from "./bootQuery.ts";

describe("readBootQuery", () => {
  it("leaves a plain URL alone", () => {
    const q = readBootQuery({ search: "?tab=foryou", pathname: "/", hash: "" });
    assert.equal(q.cleanUrl, null);
    assert.equal(q.authError, null);
    assert.equal(q.authOk, false);
    assert.equal(q.checkout, null);
  });

  it("strips callback flags and keeps the rest of the query and hash", () => {
    const q = readBootQuery({
      search: "?auth=ok&tab=foryou",
      pathname: "/dashboard",
      hash: "#top",
    });
    assert.equal(q.authOk, true);
    assert.equal(q.cleanUrl, "/dashboard?tab=foryou#top");
  });

  it("routes any checkout result to /usage", () => {
    const success = readBootQuery({
      search: "?checkout=success&session_id=cs_123",
      pathname: "/",
      hash: "",
    });
    assert.equal(success.checkout, "success");
    assert.equal(success.sessionId, "cs_123");
    assert.equal(success.cleanUrl, "/usage");
    const cancel = readBootQuery({
      search: "?checkout=cancel",
      pathname: "/",
      hash: "",
    });
    assert.equal(cancel.checkout, "cancel");
    assert.equal(cancel.cleanUrl, "/usage");
  });

  it("maps auth_error codes to a message", () => {
    const q = readBootQuery({
      search: "?auth_error=denied",
      pathname: "/",
      hash: "",
    });
    assert.equal(q.authError, "Login was cancelled.");
    assert.equal(q.cleanUrl, "/");
  });
});
