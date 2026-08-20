import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tryHandleInteracted } from "./interactedHttp.ts";

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ handled: boolean; status: number; json: Record<string, unknown> }> {
  const req = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(req, {
    method,
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  });
  let status = 0;
  let raw = "";
  const res = {
    writeHead: (code: number) => {
      status = code;
    },
    end: (chunk: string) => {
      raw = chunk;
    },
  } as unknown as ServerResponse;
  const handledPromise = tryHandleInteracted(
    req,
    res,
    new URL(`http://localhost${path}`),
  );
  if (body !== undefined) {
    (req as EventEmitter).emit("data", Buffer.from(JSON.stringify(body)));
  }
  (req as EventEmitter).emit("end");
  const handled = await handledPromise;
  return {
    handled,
    status,
    json: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
  };
}

describe("interactedHttp", () => {
  it("GET /api/interacted returns interactions + activeIds", async () => {
    const { handled, status, json } = await call("GET", "/api/interacted");
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.interactions));
    assert.ok(Array.isArray(json.activeIds));
  });

  it("POST /api/interacted/detect rejects a missing threadId", async () => {
    const { handled, status, json } = await call(
      "POST",
      "/api/interacted/detect",
      {},
    );
    assert.equal(handled, true);
    assert.equal(status, 400);
    assert.equal(json.error, "bad_request");
  });

  it("POST /api/interacted/detect is 503 when X username is unresolved", async () => {
    const { handled, status, json } = await call(
      "POST",
      "/api/interacted/detect",
      { threadId: "123" },
    );
    assert.equal(handled, true);
    assert.equal(status, 503);
    assert.equal(json.error, "identity_unresolved");
  });

  it("POST /api/interacted rejects a missing reply URL", async () => {
    const { handled, status, json } = await call("POST", "/api/interacted", {
      threadId: "123",
      author: "@x",
    });
    assert.equal(handled, true);
    assert.equal(status, 400);
    assert.equal(json.error, "bad_request");
  });

  it("ignores unrelated paths", async () => {
    const { handled, status } = await call("GET", "/api/skipped");
    assert.equal(handled, false);
    assert.equal(status, 0);
  });
});
