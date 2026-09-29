import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ProvisionalSessionError,
  apiFetch,
  setMutationGate,
  LOCAL_API_ORIGIN,
  PROD_API_ORIGIN,
  apiBase,
  apiUrl,
  isLocalHostname,
} from "./apiBase.ts";

await describe("apiBase", () => {
  it("uses loopback API on localhost / 127.0.0.1", () => {
    assert.equal(isLocalHostname("localhost"), true);
    assert.equal(isLocalHostname("127.0.0.1"), true);
    assert.equal(isLocalHostname("xcopilot.dev"), false);
    assert.equal(apiBase("localhost"), "http://localhost:8787");
    assert.equal(apiBase("127.0.0.1"), LOCAL_API_ORIGIN);
    assert.equal(apiBase("xcopilot.dev"), PROD_API_ORIGIN);
    assert.equal(apiBase("www.xcopilot.dev"), PROD_API_ORIGIN);
  }).catch(assert.fail);

  it("prefixes paths onto the API origin", () => {
    assert.equal(
      apiUrl("/api/auth/me", "xcopilot.dev"),
      `${PROD_API_ORIGIN}/api/auth/me`,
    );
    assert.equal(
      apiUrl("api/health", "127.0.0.1"),
      `${LOCAL_API_ORIGIN}/api/health`,
    );
  }).catch(assert.fail);
});

await describe("apiFetch mutation gate", () => {
  const realFetch = globalThis.fetch;

  function install() {
    const calls: Array<{ url: string; method: string | undefined }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method });
      return new Response("{}");
    }) as typeof fetch;
    return calls;
  }

  function restore() {
    globalThis.fetch = realFetch;
    setMutationGate(null);
  }

  it("rejects every non-GET/HEAD request while the gate is closed", async () => {
    const calls = install();
    setMutationGate(() => false);
    try {
      for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
        await assert.rejects(apiFetch("/api/x", { method }), ProvisionalSessionError);
      }
      assert.equal(calls.length, 0);
    } finally {
      restore();
    }
  }).catch(assert.fail);

  it("lets GET and HEAD through while the gate is closed", async () => {
    const calls = install();
    setMutationGate(() => false);
    try {
      await apiFetch("/api/x");
      await apiFetch("/api/x", { method: "GET" });
      await apiFetch("/api/x", { method: "head" });
      assert.equal(calls.length, 3);
    } finally {
      restore();
    }
  }).catch(assert.fail);

  it("lets writes through when the gate opens or is removed", async () => {
    const calls = install();
    let open = false;
    setMutationGate(() => open);
    try {
      await assert.rejects(apiFetch("/api/x", { method: "POST" }), ProvisionalSessionError);
      open = true;
      await apiFetch("/api/x", { method: "POST" });
      setMutationGate(null);
      await apiFetch("/api/x", { method: "PUT" });
      assert.equal(calls.length, 2);
    } finally {
      restore();
    }
  }).catch(assert.fail);
});
